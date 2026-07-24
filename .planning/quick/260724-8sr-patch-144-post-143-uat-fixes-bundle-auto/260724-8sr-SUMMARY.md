---
phase: quick-260724-8sr
plan: 01
subsystem: pretty-view-panel, ssh-terminal, css-tokens
tags: [patch-144, ios-pwa, visibility-reconnect, active-set, safe-area, css]
dependency-graph:
  requires:
    - patch-141 (locked pretty-conversations panel structure)
    - patch-142 (fixed top-left chevron; sidebarToggleOverlaps prop)
    - patch-143 (v1 visibilitychange auto-reconnect useEffect scaffolding)
  provides:
    - Terminal.tsx visibilitychange handler v2 (readyState guard removed)
    - .pv-panel-group CSS rule + three group-wrapper applications
    - useEffect wire for selectedId → activeSet enrollment
    - html { background-color: var(--color-pv-base-end); } safe-area anchor
    - unconditional "Conversations" title render on mobile
  affects:
    - iOS PWA foreground UX (no more spurious 8-attempt flash + manual overlay)
    - mobile-in-conversation back chevron (dedup — one chevron instead of two)
    - conversation-list row treatment after URL-fragment restore
    - iOS PWA bottom safe-area color
tech-stack:
  added: []
  patterns:
    - "single atomic commit for a bundled UAT-fix patch (fork discipline)"
    - "test-spec inversion pattern (Test 8 mobile-title; Test 10 visibilitychange OPEN branch)"
    - "byte-for-byte handler mirror in test file kept in lockstep with source"
key-files:
  created: []
  modified:
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
    - src/ui/AppShell.tsx
    - src/ui/index.css
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Fix (b) cleanup extended beyond plan text to also delete the now-dead `isMobileViewScreen` const (Rule 1). Plan grep gate for that symbol expected count=2; actual is 1. Deviation documented below."
  - "Fix (c) resolves the safe-area COLOR only. Reclaiming ~5/6 of the bottom space for usable content (leaving 1/6 for the home indicator) is a follow-up second-order tweak, deferred to a separate patch."
  - "Pinned rows wrapped in an explicit `pv-panel-group` div (plan-mandated) so the three-group pattern is uniform. Verified Tests 2/3/4 still pass — they query by `[data-conversation-id]` / `compareDocumentPosition` / text-walk which are all depth-agnostic."
metrics:
  duration: "~5 minutes (interactive)"
  completed: "2026-07-24T06:38:16Z"
---

# Quick Task 260724-8sr Patch #144: Post-#143 UAT Fixes Bundle Summary

**One-liner:** Six independent UAT-caught regressions from the #141+#142+#143 batch, closed in one atomic commit on `feat/tab-title-from-tmux`: iOS-PWA visibility auto-reconnect v2 (drop stale-OPEN guard), redundant mobile back-chevron deletion, PWA safe-area bottom color fix, selectedId → activeSet enrollment for URL-fragment restore, intra-group row gap uniformity, and unconditional "Conversations" title on mobile.

## What Shipped

### Fix (a) — Terminal.tsx: patch #143 v2 (drop the `readyState === OPEN` guard)

**Root cause (Ashley's diag):** iOS PWA resumes JS with the old `webSocketRef.current` still reading `readyState === OPEN` because the queued `close` event hasn't been delivered yet → v1 handler short-circuits → the delayed `close` event then fires `attemptReconnection` → `scheduleReconnect` burns 8 attempts against a stale WS → user sees "1/8..8/8 reconnecting" flash then the manual overlay.

**Fix:** Two lines deleted from inside the visibilitychange useEffect (`const ws = webSocketRef.current; if (ws && ws.readyState === WebSocket.OPEN) return;`). JSDoc rephrased to the v2 spec explaining why the guard was removed. Every other guard preserved (`isUnmountingRef`, `wasDisconnectedBySSH.current` — target-terminated boundary is load-bearing).

**Rationale for idempotency:** If the old WS was genuinely alive, calling `connectToHost` will open a fresh WS, the old one will close cleanly on its own timeline, and tmux reattach handles restoration. No user-visible harm.

### Fix (b) — AppShell.tsx: delete redundant mobile back-chevron header

**Root cause (Ashley's diag):** Two chevrons render simultaneously on mobile-in-conversation — the fixed patch #142 chevron at (8,8) z-30 (lines 1400-1444, aria-label "Back to conversations" on touch) AND the legacy 50x49 shadcn Button chevron at (0,0). Identity badge (top-right) already surfaces conversation identity, so the `activeConversationLabel` span had become dead weight.

**Fix:** Deleted the entire `{isMobileViewScreen && (<div>...<Button>...<Separator/>...<span>{activeConversationLabel}</span></div>)}` block at lines 1549-1570 plus the 10-line JSX comment above it. Cleanup: `activeConversationLabel` derivation removed (no other consumers); `Button` + `Separator` imports removed (no other consumers).

**Deviation extension:** Also removed the now-dead `isMobileViewScreen` const derivation (Rule 1 — unused const created by this task). This changes the plan's grep-gate expectation for `isMobileViewScreen` from 2 to 1; documented in the "Deviations from Plan" section below.

### Fix (c) — index.css: `<html>` background = pv-base-end for iOS PWA safe area

**Root cause (Ashley's diag):** `body.bgColor === rgb(10, 11, 18)` (correct pv-base-end) but `html.bgColor === rgba(0, 0, 0, 0)` (transparent). iOS PWA paints safe-area-inset-bottom with the `<html>` bg → transparent shows through as ~1cm black bar.

**Fix:** New top-level CSS rule placed immediately AFTER the `@layer base { … }` close so it wins against Tailwind resets without needing `!important`:

```css
html {
  background-color: var(--color-pv-base-end);
}
```

References `--color-pv-base-end` (via `@theme inline` mapping from `.dark { --background: #0a0b12 }`) directly so a future theme rebase moving `--background` away from `#0a0b12` won't silently break this. `body { background-color: var(--background); }` untouched.

**Scope note:** This resolves the COLOR only. The bottom ~1cm safe area still isn't usable for content. Reclaiming ~5/6 of that space (leaving the bottom ~1/6 for the iOS home indicator) is a follow-up second-order tweak — likely adjusting the compose-box `py-2` or the AppShell wrapper's `paddingBottom: max(env(safe-area-inset-bottom), 0px)` at line 1738-1742 — deferred to a separate patch.

### Fix (d) — PrettyConversationsPanel.tsx: activeSet on every selectedId change

**Root cause (Ashley's diag):** All 32 rendered rows carried `pv-row pv-row--mobile ambient` — NONE non-ambient (activeSet empty) despite an open conversation. Cause: `addToActiveSet` fires only from `handleRowSelect` (click path). URL-fragment restore bypasses the click path and sets `selectedId` programmatically → activeSet stays empty → rows render `ambient`.

**Fix:** Extended the React import from `useState` → `useEffect, useState`. New useEffect immediately after `const activeSet = useActiveSet();`:

```tsx
useEffect(() => {
  if (selectedId) addToActiveSet(selectedId);
}, [selectedId]);
```

`addToActiveSet` is idempotent (early-return when id already present in the set), so double-fires from click-that-also-changes-selectedId are harmless no-ops.

**Placement rationale:** In the panel (not AppShell) because the panel is the surface where the ambient/full-bubble distinction matters, and it already subscribes to `useSelectedConversationId()`. AppShell doesn't read `selectedId` today, so putting the effect there would introduce a broader re-render surface for no gain.

### Fix (e) — pretty-conversations.css + Panel: intra-group row gap

**Root cause (Ashley's diag):** `.pv-panel-scroll` `gap: 8px` applies only BETWEEN groups (pinned wrapper / regular host wrappers / RDP-sentinel wrapper). Individual rows inside each `<div className="flex flex-col">` group wrapper are edge-to-edge because the wrappers have no gap declared.

**Fix:** New CSS rule (pretty-conversations.css, immediately after `.pv-panel-scroll { … }`):

```css
.pv-panel-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

Applied `pv-panel-group` class to all three group wrappers in `PrettyConversationsPanel.tsx`:

1. **Pinned rows** — the pinned `.map(...)` output was rendering as siblings under `.pv-panel-scroll` directly (no wrapping div). Wrapped them in `<div className="pv-panel-group" data-pinned-group="true">…</div>` so the three-section pattern is uniform.
2. **Regular host groups** — `className="flex flex-col"` → `className="pv-panel-group"` on the per-host wrapper.
3. **RDP-sentinel group** — same swap on the `data-rdp-group="true"` wrapper.

Tests 2/3/4 verified still passing — they query `[data-conversation-id]` (depth-agnostic), `compareDocumentPosition` (depth-agnostic), and walk-for-direct-text-node (empty wrapper divs carry no direct text, inert to the walk).

### Fix (f) — PrettyConversationsPanel.tsx: "Conversations" title on mobile

**Root cause (Ashley confirmed):** Prior handoff note "deliberately left off per Phase 10 design" was WRONG. Mobile-list-screen should show the "Conversations" title same as desktop.

**Fix:** Removed the `const showDesktopTitle = variant === "desktop";` derivation and inlined the title as `<span className="pv-title">{headerLabel}</span>` unconditionally (dropped the ternary that emitted an empty aria-hidden span on mobile). `sidebarToggleOverlaps` padding-left clearance stays desktop-only via AppShell's `!isMobile && !isTouchDevice && sidebarOpen` gate at the mount site — no AppShell change needed.

## Files Modified

| File | Change Type | Lines |
|------|-------------|-------|
| `src/ui/features/terminal/Terminal.tsx` | patch #143 v2 (drop readyState guard + JSDoc rephrase) | -3/+8 |
| `src/ui/features/terminal/Terminal.wiring.test.ts` | helper mirror updated, Test 10 inverted | +18/-5 |
| `src/ui/AppShell.tsx` | delete legacy mobile back-chevron block + activeConversationLabel + isMobileViewScreen + Button/Separator imports | -39/+9 |
| `src/ui/index.css` | html {background-color: var(--color-pv-base-end)} rule | +11/-0 |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | useEffect for selectedId→activeSet; three group wrappers use pv-panel-group; title unconditional on mobile | +44/-33 |
| `src/ui/features/pretty-conversations/pretty-conversations.css` | .pv-panel-group rule | +10/-0 |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | addToActiveSet mock → spy; Test 8 inverted; +Tests 16/17 | +47/-9 |
| **Total** | **7 files** | **+147/-89 (net +58)** |

## Verification Results

### type-check

- Command: `npm run type-check`
- Result: **clean** (no errors)

### targeted vitest

- Command: `npm test -- terminal pretty-conversations --run`
- Result: **59/59 tests passing across 4 files**
  - `Terminal.test.tsx`: 7/7
  - `Terminal.wiring.test.ts`: 16/16 (Test 10 spec inverted per Fix (a))
  - `PrettyConversationRow.test.tsx`: 20/20
  - `PrettyConversationsPanel.test.tsx`: 16/16 (Test 8 inverted per Fix (f); +Tests 16/17 per Fix (d))
- Duration: 13.29s (transform 1.99s, setup 159ms, import 6.19s, tests 759ms, environment 5.10s)

### build

- Command: `npm run build`
- Result: **succeeded in 6.42s**
- Bundle sizes unchanged in the noteworthy tier (AppShell shrank slightly per the -39/+9 diff)

### grep gates (from plan `<verify>`)

| # | Gate | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | `readyState === WebSocket.OPEN` in Terminal.tsx | 8 | 8 | ✅ |
| 2 | `Back to conversations` in AppShell.tsx | 2 | 2 | ✅ |
| 3 | `isMobileViewScreen` in AppShell.tsx | 2 | **1** | ⚠️ **deviation** |
| 4 | `background-color: var(--color-pv-base-end)` in index.css | 1 | 1 | ✅ |
| 5 | `addToActiveSet` in PrettyConversationsPanel.tsx | ≥3 | 4 | ✅ |
| 6 | `pv-panel-group` in pretty-conversations.css | ≥1 | 1 | ✅ |
| 7 | `pv-panel-group` in PrettyConversationsPanel.tsx | ≥3 | 4 | ✅ |
| 8 | `visibilitychange` in GuacamoleDisplay.tsx | 2 (untouched) | 2 | ✅ |

Gate 3 deviation is intentional — see "Deviations from Plan" below.

### Post-commit sanity

`git log -1 --stat` shows exactly the 7 target files listed in `files_modified`, no extras.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug/Cleanup] Removed dead `isMobileViewScreen` const derivation**

- **Found during:** Fix (b) execution
- **Issue:** After deleting the `{isMobileViewScreen && (...)}` JSX block per plan step 2, `isMobileViewScreen` had zero live consumers. Leaving it as a top-level `const` derivation is dead code — a code-smell bug directly caused by this task's changes.
- **Fix:** Deleted the derivation at (was) line 1344, replaced it with a Patch #144 explanatory comment.
- **Files modified:** `src/ui/AppShell.tsx`
- **Commit:** `7420a6a` (same atomic commit as the rest of the patch)
- **Plan gate impact:** The plan's grep gate `test $(grep -c "isMobileViewScreen" src/ui/AppShell.tsx) -eq 2` now returns 1 instead of 2. Root-cause analysis of the mismatch: the plan text specified deleting the 10-line JSX comment block containing an `` `isMobileViewScreen` `` mention in step 1 (baseline 3 → 2 after step 1 alone), then either leaving `isMobileViewScreen` alive (baseline stays at 2 — plan's stated expectation) or removing it (baseline drops to 0). The plan wanted the middle state, but that leaves a dead const. Reasoning: dead-const cleanup is preferable to preserving the count invariant; documenting the deviation here satisfies the plan's "if any grep gate fails … investigate the mismatch, fix the root cause" guidance without contriving a fake consumer to satisfy the count.

### Pre-existing Test Failures (Unchanged Baseline)

**2× patch #124 ThumbsUp aria-label residuals** in `ComposeBox.test.tsx` (out of scope for this patch — carried forward per Ashley's 2026-07-23 test-hygiene deferral rule). Not triggered by the targeted `terminal pretty-conversations` test scope for this patch.

## Follow-up Bookkeeping

1. **Fix (c) reclaim-space follow-up.** Fix (c) resolves the safe-area bottom COLOR only. Reclaiming ~5/6 of that ~1cm bottom space for usable content (leaving the bottom ~1/6 for the iOS home indicator) is a separate second-order tweak — likely adjusting the compose-box `py-2` and/or the AppShell wrapper's `paddingBottom: max(env(safe-area-inset-bottom), 0px)` inline style at line 1738-1742 to a smaller derived value. Not shipped in this patch.

2. **Deploy status.** Batched with #141+#142+#143 (all sitting on `feat/tab-title-from-tmux`) pending Ashley greenlight per her 2026-07-23 batch-writeups-until-deploy rule. No push, no deploy from this patch.

3. **Button/Separator cleanup succeeded fully.** No unexpected consumer surfaced during tsc; both imports were the only usages beyond the deleted block. Cleanup didn't need to be partially aborted.

4. **`~/.claude/identities/tina/skynet-patches.md` NOT touched.** Awaiting Ashley greenlight to deploy before writing up the batch (patches #141-#144).

## Self-Check: PASSED

- `src/ui/features/terminal/Terminal.tsx` — modified ✅
- `src/ui/features/terminal/Terminal.wiring.test.ts` — modified ✅
- `src/ui/AppShell.tsx` — modified ✅
- `src/ui/index.css` — modified ✅
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — modified ✅
- `src/ui/features/pretty-conversations/pretty-conversations.css` — modified ✅
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified ✅
- Commit `7420a6a` — present in `git log` on `feat/tab-title-from-tmux` ✅
- type-check clean ✅
- 59/59 targeted tests green ✅
- `npm run build` succeeded in 6.42s ✅
- 7/8 grep gates pass verbatim; gate 3 documented deviation ✅
