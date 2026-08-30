---
phase: 57-drop-preview-overlay-edge-zone-hit-testing-replace-placehold
plan: 02
subsystem: pretty-view / split-tree
tags: [drop-preview, pane, flicker-fix, structured-logging, phase-57, tdd]
requires:
  - "src/ui/lib/split-tree.ts (Plan 57-01 exports: DropZone alias + computeEdgeZone pure function + EDGE_ZONE_THRESHOLD)"
  - "src/ui/shell/SplitView.tsx (Phase 56 Plan 03 Pane native-listener attachment mechanism — LOAD-BEARING patch #514 preserved; body rewired)"
  - "~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html (reference: overlay CSS :177-188, geometry :414-421, zone picker :361-370)"
provides:
  - "src/ui/shell/SplitView.tsx — Pane component with live coral drop-preview overlay, edge-zone-driven geometry, bounding-rect flicker fix, silent center-dead-zone drop short-circuit, and window-scoped dragend cleanup"
  - "src/ui/shell/SplitView.tsx — module-local `overlayGeometryForZone(zone, rect)` helper returning pane-local `{ left, top, width, height }` for the four edge zones (t = 0.5)"
  - "12 new component tests in src/ui/shell/SplitView.test.tsx under `describe('SplitView — Phase 57: drop-preview overlay + edge-zone hit-testing')` covering overlay presence + zone-driven geometry + flicker fix + center dead-zone silence + Phase 56 contract preservation + zone-change logging + pointer-events guard + deep-tree isolation + window-dragend cleanup"
affects:
  - "src/ui/shell/SplitView.tsx (Pane component rewire — 161 additions, 15 deletions net)"
  - "src/ui/shell/SplitView.test.tsx (new describe block — 381 additions; Phase 56 tests untouched)"
tech_stack:
  added: []
  patterns:
    - "TDD RED→GREEN: failing tests committed first (5ca8713d), implementation second (69b8034c)"
    - "Native DOM listeners preserved (patch #514 mechanism intact) — React portals bubble via React tree, not DOM tree, so native listeners on the Pane's outer div are the only reliable way to catch drops on portaled PrettyView content"
    - "Structural bail-out via functional setState — same-zone dragovers return the prev object identity so React skips the re-render (cursor motion within a zone → zero component churn)"
    - "Ref-based zone-change gate — prevZoneRef captures the last-emitted zone synchronously inside the native listener body, avoiding React 18 strict-mode double-fire of the [pv-split-preview] log"
    - "Stateless bounding-rect flicker guard — no counter/relatedTarget/el.contains machinery; just clientX/Y ∈ getBoundingClientRect(). Robust across React-portal / DOM-tree mismatches"
    - "Type-gated dragleave — text/plain check FIRST, before the bounding-rect check, so unrelated browser/OS drags don't clear our dropPreview mid-drag (plan-check finding #3 fix)"
    - "Window-scoped dragend listener for Escape-cancel cleanup (dragend fires on the drag SOURCE, not the drop TARGET; scoping to `el` would miss it)"
key_files:
  created: []
  modified:
    - "src/ui/shell/SplitView.tsx (+161 / -15)"
    - "src/ui/shell/SplitView.test.tsx (+381)"
decisions:
  - "State shape swap: dropPreview: { zone: DropZone; rect: DOMRect } | null replaces isDragOver: boolean (Pane only; EmptyDropTarget's own isDragOver stays)"
  - "Overlay lives at SAME DOM depth as the Phase 56 placeholder it replaces — direct child of .flex-1.min-h-0.overflow-hidden.relative (SplitView.tsx:296), sibling to the [data-tab-id] portal-target (plan-check finding #2)"
  - "Ref-based prev-zone tracking (prevZoneRef) instead of functional-updater on setDropPreview — avoids React 18 strict-mode double-fire of the structured log (plan-check finding #4)"
  - "Type-gate on dragleave BEFORE bounding-rect check — protects flicker-fix machinery from unrelated browser/OS drag events (plan-check finding #3)"
  - "Window-scoped dragend listener for Escape-cancel cleanup — el-scoped would miss the event since dragend fires on the drag SOURCE (plan-check finding #7)"
  - "computeNearestEdge remains EXPORTED but no longer CALLED from Pane — Phase 56 Plan 03 tests still import and test it directly (regression guard)"
  - "One edge picker per drop — computeEdgeZone replaces computeNearestEdge at the Pane's drop site, guaranteeing overlay preview + actual land match (CONTEXT.md §What would make it wrong)"
  - "overlayGeometryForZone helper is module-local (not exported) — tests query DOM inline styles directly, no need to widen the module's surface for unit testability"
  - "Bounding-rect flicker fix over counter-based / relatedTarget-based — stateless, robust across React-portal / DOM-tree mismatches (CONTEXT.md §Gap (a) rationale)"
metrics:
  duration_iso: "PT14M"
  tasks_completed: 1
  files_modified: 2
  files_created: 0
  tests_added: 12
  tests_total: 26
  commits: 2
  completed_date: "2026-08-28"
requirements_completed:
  - PV57-DROP-PREVIEW-OVERLAY
  - PV57-FLICKER-FIX
  - PV57-CENTER-DEAD-ZONE-SHORT-CIRCUIT
  - PV57-STRUCTURED-LOGGING
  - PV57-SNAP-TO-NEAREST-EDGE
---

# Phase 57 Plan 02: Pane drop-preview overlay + edge-zone hit-testing Summary

**One-liner:** Rewired `Pane` to render a live coral overlay that snaps to the nearest edge on every dragover via Plan 57-01's `computeEdgeZone`, added a stateless bounding-rect flicker guard that survives portaled-child boundary crossings, silenced the center-dead-zone drop with a structured `[pv-split-drop] center-dead-zone ignored` log while preserving the Phase 56 outward handler contract for edge-zone drops, and attached a window-scoped `dragend` cleanup listener so Escape-cancel doesn't leave a stuck overlay.

## What shipped

Phase 57's payload — the interaction Ashley demoed in `prototype.html` is now live inside Skynet's Pane. Cursor movement over a pane shows the exact future split shape; releasing near the dead center is a silent "cancel" gesture. All 12 new Phase 57 tests pass alongside all 14 pre-existing Phase 56 tests in the same file (26 total in `SplitView.test.tsx`), broader scoped suite is 79/79 green, `tsc --noEmit` clean.

Two commits, TDD gate compliance:

| Commit    | Kind | Files                                       | Notes                                                                                        |
| --------- | ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `5ca8713d` | test | `src/ui/shell/SplitView.test.tsx` (+381)     | RED — 10 of 12 new tests fail against current placeholder-only Pane. Tests 1/4 pass by coincidence (no overlay ever renders in current impl, so absent-overlay assertions trivially pass). |
| `69b8034c` | feat | `src/ui/shell/SplitView.tsx` (+161 / -15)   | GREEN — state shape swap, listener body rewire, JSX overlay swap, `computeNearestEdge` callsite removed. All 26 tests in file pass; broader scoped suite 79/79 pass. |

No REFACTOR commit. The implementation was a direct port with all intermediate structure baked into the GREEN commit; further "cleanup" would risk drifting from Ashley's prototype-validated visual language.

## Exact overlay CSS shipped

Per plan `<output>` requirement — verbatim from `src/ui/shell/SplitView.tsx` (JSX at lines 440-459):

```jsx
{dropPreview !== null && dropPreview.zone !== "center" && (
  <div
    data-testid="pane-drop-preview-overlay"
    data-zone={dropPreview.zone}
    className="absolute pointer-events-none"
    style={{
      ...overlayGeometryForZone(dropPreview.zone, dropPreview.rect),
      background: "rgba(255, 184, 150, 0.22)",
      border: "2px solid rgba(255, 184, 150, 0.60)",
      borderRadius: 0,
      zIndex: 20,
      transition:
        "left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease",
    }}
  />
)}
```

Grep evidence:

| Property | Value | Grep command | Result |
|----------|-------|--------------|--------|
| Fill (background) | `rgba(255, 184, 150, 0.22)` | `grep -c 'rgba(255, 184, 150, 0.22)' src/ui/shell/SplitView.tsx` | **1** |
| Border | `2px solid rgba(255, 184, 150, 0.60)` | `grep -c 'rgba(255, 184, 150, 0.60)' src/ui/shell/SplitView.tsx` | **1** |
| Coral rgba total (fill + border) | 2 lines | `grep -c 'rgba(255, 184, 150' src/ui/shell/SplitView.tsx` | **2** |
| Border-radius | `0` (inline) | inline in style object | ✓ |
| pointer-events | `pointer-events-none` (Tailwind) | `grep -c 'pointer-events-none' src/ui/shell/SplitView.tsx` | **4** (this overlay + Divider :78 + Divider :86 + stale-tab placeholder :422) |
| z-index | `20` (inline) | matches Phase 56 placeholder z-index | ✓ |
| Transition | `left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease` | matches prototype.html:185 | ✓ |
| Stable testid | `data-testid="pane-drop-preview-overlay"` | `grep -c 'data-testid="pane-drop-preview-overlay"' src/ui/shell/SplitView.tsx` | **1** |
| Stable zone attr | `data-zone={dropPreview.zone}` | queryable in tests | ✓ |

Color rationale: `rgba(255, 184, 150)` matches the app's `--color-pv-code-fg: #ffb896` at `src/ui/index.css:159` exactly (255=0xff, 184=0xb8, 150=0x96) — this IS the app's coral token, dropped into the overlay at alpha 0.22 (fill) and 0.60 (border), tracking the prototype's `--highlight: rgba(255,184,150,0.20)` + `--highlight-strong: rgba(255,184,150,0.55)` with a small nudge for the darker base of Skynet's fork per Ashley's shape-file preference for legible-first CSS.

## computeNearestEdge — untouched, still exported, no longer called from Pane

Per plan `<output>` requirement — grep evidence:

| Check | Command | Result |
|-------|---------|--------|
| Still exported from SplitView.tsx | `grep -c '^export function computeNearestEdge(' src/ui/shell/SplitView.tsx` | **1** ✓ |
| Total callsites in file | `grep -c 'computeNearestEdge(' src/ui/shell/SplitView.tsx` | **1** (the export line only — zero callsites in Pane) ✓ |
| Test file still imports it | `grep -c 'computeNearestEdge' src/ui/shell/SplitView.test.tsx` | **6** (import + 5 unit-test assertions in Phase 56 Plan 03 describe block, unchanged) ✓ |

The function body at `src/ui/shell/SplitView.tsx:80-105` (the export moved up by 36 lines because of the new `overlayGeometryForZone` helper insertion above the Pane component; body itself unchanged) still returns the same `DropEdge` for the same `(rect, clientX, clientY)` input.

## stopPropagation guard chain (center-dead-zone AppShell isolation)

Per plan `<output>` requirement — confirming the AppShell outer container's onDrop at `AppShell.tsx:2265` does NOT fire on center-dead-zone drops:

From `src/ui/shell/SplitView.tsx` drop handler (:260-341):

```ts
const onDrop = (e: DragEvent) => {
  if (!e.dataTransfer?.types.includes("text/plain")) return;
  e.preventDefault();
  // Prevent AppShell outer container's onDrop from also firing —
  // CRITICAL for the center-dead-zone short-circuit: the guard chain
  // (preventDefault + stopPropagation) fires BEFORE the center-check
  // return so the AppShell handler at AppShell.tsx:2265 never sees the
  // payload even for center-dead-zone drops.
  e.stopPropagation();
  setDropPreview(null);
  prevZoneRef.current = null;
  const rect = el.getBoundingClientRect();
  const zone = computeEdgeZone(rect, e.clientX, e.clientY);
  // Center-dead-zone short-circuit. Silent per shape file: no error, no
  // toast, no visual affordance — release does nothing, no drop registered.
  if (zone === "center") {
    console.info(
      `[pv-split-drop] center-dead-zone ignored path=${JSON.stringify(path)} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}`,
    );
    return;
  }
  // …edge-zone branch continues from here, calling onOpenSessionInTree
  // / onDropRowInTree with the picked edge…
};
```

`e.preventDefault()` + `e.stopPropagation()` fire on line 263-264, BEFORE the `computeEdgeZone` call on :274 and the `zone === "center"` check on :276. Grep-verified:

```
$ grep -n 'preventDefault\|stopPropagation' src/ui/shell/SplitView.tsx | head
150:        e.preventDefault();      # EmptyDropTarget onDragOver
155:        e.preventDefault();      # EmptyDropTarget onDrop
263:        e.preventDefault();      # Pane onDrop — CENTER-DEAD-ZONE GUARD FIRES BEFORE RETURN
264:        e.stopPropagation();     # Pane onDrop — CENTER-DEAD-ZONE GUARD FIRES BEFORE RETURN
316:        e.preventDefault();      # Pane onDragOver
322:        e.stopPropagation();     # Pane onDragOver
```

Test 7 asserts this — `dispatchDropAt(paneOuter, 50, 50, ...)` in the center dead zone fires; neither `onOpenSessionInTree` nor `onDropRowInTree` is called; but the `[pv-split-drop] center-dead-zone ignored` log line fires (via `console.info` spy). If `stopPropagation` did not fire, the drop event would bubble to AppShell.tsx:2265 and Ashley's payload would leak into a "center-drop opened a new tab" surprise — which the shape file explicitly locks against.

## Test-run output

Per plan `<output>` requirement — line count of passing tests in `SplitView.test.tsx`:

```
 RUN  v4.1.8 /home/ubuntu/skynet-tanya

 Test Files  1 passed (1)
      Tests  26 passed (26)
   Start at  18:53:54
   Duration  6.93s
```

**26 = 6 Plan 02 + 8 Plan 03 + 12 Plan 57 (Tests 1-11 + Test 13).** No discrete Test 12 — that is a documentation-only regression assertion satisfied by the overall pass of the Plan 02 + Plan 03 blocks.

Broader scoped consumer sweep (fleet-rule replacement for `--related` which isn't supported in vitest 4.1.8; per Plan 57-01 SUMMARY deviation-2):

```
$ npx vitest run src/ui/shell/SplitView.test.tsx src/ui/lib/split-tree.test.ts \
    src/ui/lib/split-tree-url.test.ts src/ui/AppShell.split-tree.test.tsx

 Test Files  4 passed (4)
      Tests  79 passed (79)
   Duration  31.23s
```

TypeScript:

```
$ npx tsc --noEmit 2>&1 | grep -c "error TS"
0
```

## Acceptance criteria — all satisfied

| # | Criterion | Verify | Result |
|---|-----------|--------|--------|
| 1 | Pane uses dropPreview state | `grep -c 'useState<{ zone: DropZone; rect: DOMRect } \| null>' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 2 | Pane no longer uses isDragOver (EmptyDropTarget still does — CORRECT) | Manual inspection of :143-156 (EmptyDropTarget scope only) | ✓ |
| 3 | Pane imports computeEdgeZone | `grep -c 'computeEdgeZone' src/ui/shell/SplitView.tsx` | **4** (≥2 required — import + dragover call + drop call + JSDoc helper mention) ✓ |
| 4 | Pane imports DropZone | `grep -c 'DropZone' src/ui/shell/SplitView.tsx` | **4** (≥2 required — type import + helper input type + state type + JSDoc) ✓ |
| 5 | Overlay JSX gated on non-center zone | `grep -c 'dropPreview.zone !== "center"' src/ui/shell/SplitView.tsx` | **2** (JSDoc :44 + JSX gate :442; JSX gate is the semantic requirement) ✓ |
| 6 | Overlay has stable data-testid | `grep -c 'data-testid="pane-drop-preview-overlay"' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 7 | Center-dead-zone log line present | `grep -c '\[pv-split-drop\] center-dead-zone ignored' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 8 | Structured [pv-split-preview] log line present | `grep -c '\[pv-split-preview\] pane path=' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 9 | computeNearestEdge still exported | `grep -c '^export function computeNearestEdge(' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 10 | computeNearestEdge no longer called from Pane | `grep -c 'computeNearestEdge(' src/ui/shell/SplitView.tsx` | **1** (export line only — zero callsites) ✓ |
| 11 | isDragOver ring class removed from Pane | Inspection: `isDragOver ? "ring-2 ring-inset ring-accent-brand"` only appears in EmptyDropTarget scope :147 — Pane's outer div className at :392 has no such segment | ✓ |
| 12 | Overlay has pointer-events-none | `grep -c 'pointer-events-none' src/ui/shell/SplitView.tsx` | **4** (≥1 required in overlay) ✓ |
| 13 | Coral color from app token | `grep -c 'rgba(255, 184, 150' src/ui/shell/SplitView.tsx` | **2** (fill + border) ✓ |
| 14 | New describe block in test file | `grep -c 'describe("SplitView — Phase 57: drop-preview overlay' src/ui/shell/SplitView.test.tsx` | **1** ✓ |
| 15 | New dispatch helpers present | `grep -c 'dispatchDragOverAt\|dispatchDragLeaveAt' src/ui/shell/SplitView.test.tsx` | **16** (≥4 required — 2 defs + 14 callsites) ✓ |
| 16 | Window dragend listener attached | `grep -c 'window.addEventListener("dragend"' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 17 | Window dragend listener cleanup paired | `grep -c 'window.removeEventListener("dragend"' src/ui/shell/SplitView.tsx` | **1** ✓ |
| 18 | Phase 57 tests all pass | `npx vitest run src/ui/shell/SplitView.test.tsx` | **26/26 pass** ✓ |
| 19 | Phase 56 regression clean | Same run — Plan 02 + Plan 03 blocks unchanged and green | ✓ |
| 20 | Scoped consumer sweep green | 4-file sweep | **79/79 pass** ✓ |
| 21 | TypeScript clean | `npx tsc --noEmit \| grep -c "error TS"` | **0** ✓ |
| 22 | No new React imports | `grep -c '^import React' src/ui/shell/SplitView.tsx` | **1** (existing line unchanged) ✓ |
| 23 | No AppShell / PrettyView / URL-codec files touched | `git diff --stat HEAD~2..HEAD \| grep -E 'AppShell\|PrettyView\|split-tree-url\|PrettyConversationRow'` | **empty** ✓ |

## Deviations from Plan

### None (no Rule 1/2/3/4 deviations required)

Plan 57-02 was internally consistent. The 7 plan-check-finding fixes baked into the plan by the planner were applied verbatim during implementation:

- **Finding #1 (test helpers replicate dispatchDropAt shape):** Applied in `dispatchDragOverAt` and `dispatchDragLeaveAt` at test file lines 421-455. Both use `createEvent.dragOver` / `createEvent.dragLeave` + `Object.defineProperty` for clientX/Y + dataTransfer stub with `types: ["text/plain"]`.
- **Finding #2 (overlay same parent as placeholder):** Overlay JSX at :440-459 is a direct child of `.flex-1.min-h-0.overflow-hidden.relative` at :435, sibling to the `[data-tab-id]` portal-target div at :436-440. Same DOM depth as the Phase 56 placeholder it replaced.
- **Finding #3 (dragleave type-gate first, then bounding-rect):** Applied at :246-257 — `if (!e.dataTransfer?.types.includes("text/plain")) return;` on :246, bounding-rect check on :253. Ref reset on :258 alongside `setDropPreview(null)`.
- **Finding #4 (prev-zone tracked via useRef, not setState functional updater):** `prevZoneRef` declared at :222, compared + written at :225-232 inside the native listener body.
- **Finding #5 (frontmatter depends_on bracket form):** Not applicable to executor — planner concern.
- **Finding #6 (mobile-leak guard transitively covered):** No mobile check added. Verified via `grep -n 'isMobile' src/ui/AppShell.tsx` — `!isMobile && (<SplitView …/>)` gate at :2372 transitively guards the overlay from ever mounting on mobile widths.
- **Finding #7 (window-level dragend cleanup):** Applied at :353-356 (listener body), :361 (attach), :367 (removeEventListener). Test 13 asserts the cleanup.

No Rule 4 (architectural) surfaces triggered.

## Fleet-rule compliance

- ✓ No `git worktree add` — ran directly on `feat/tab-title-from-tmux`.
- ✓ No `git push`, no `docker build`, no `docker compose up`, no touches under `/opt/skynet/`. Ship is orchestrator-only.
- ✓ Scoped tests only — file-scoped `SplitView.test.tsx` for TDD gates + 4-file targeted-path sweep for consumer verification. Did NOT run full-suite `npx vitest run`.
- ✓ Normal `git commit` (hooks skipped only because husky hooks aren't executable on this box — git's own warning surfaced; not bypassed via `--no-verify`).
- ✓ SUMMARY.md written before any narration, immediately followed by commit.

## TDD Gate Compliance

- **RED gate:** `test(57-02)` commit `5ca8713d` — 10 of 12 new tests fail against current placeholder-only Pane. Tests 1 and 4 pass by coincidence (both assert overlay-is-absent, which is trivially true against a Pane that never renders the overlay), NOT by fluke — Test 1 is explicitly the "no drag in progress → no overlay" check and Test 4 is the center-dead-zone-no-overlay check; both should pass against the future GREEN implementation too, and they do. The RED-fail semantic (dragover-then-overlay-should-render) is captured by Tests 2/3/5/6/8/9/10/11/13, all of which fail RED. ✓
- **GREEN gate:** `feat(57-02)` commit `69b8034c` — all 26 tests in `SplitView.test.tsx` pass. Broader scoped sweep 79/79. `tsc --noEmit` clean. ✓
- **REFACTOR gate:** Not needed. GREEN implementation is a direct port with no intermediate rework required. Documented rationale. ✓

## Self-Check

**Files verified to exist:**

```
[ -f /home/ubuntu/skynet-tanya/src/ui/shell/SplitView.tsx ] && echo FOUND
[ -f /home/ubuntu/skynet-tanya/src/ui/shell/SplitView.test.tsx ] && echo FOUND
[ -f /home/ubuntu/skynet-tanya/.planning/phases/57-drop-preview-overlay-edge-zone-hit-testing-replace-placehold/57-02-SUMMARY.md ] && echo FOUND
```

All three FOUND.

**Commits verified to exist:**

- `5ca8713d` — test(57-02): add failing tests for Pane drop-preview overlay + edge-zone hit-testing — FOUND (`git log --oneline | grep 5ca8713d`)
- `69b8034c` — feat(57-02): Pane drop-preview overlay + edge-zone hit-testing + flicker fix + center-dead-zone short-circuit — FOUND (`git log --oneline | grep 69b8034c`)

## Self-Check: PASSED

## Known Stubs

None. The Pane's drop-preview overlay is fully wired end-to-end: every dragover computes a real zone via `computeEdgeZone`, every zone drives real geometry via `overlayGeometryForZone`, every drop is either forwarded to the real Phase 56 handlers (edge zones) or silently short-circuited with a real log line (center dead zone). No TODOs, no FIXMEs, no placeholder returns, no empty-array-that-flows-to-UI patterns.

## Threat Flags

None. Per the plan's `<threat_model>`, this is pure frontend UI — no auth surface, no network surface, no persistence surface, no new payload-handling surface. Cursor coordinates come from the browser's DragEvent; rect coordinates come from `getBoundingClientRect()`. Nothing crosses a trust boundary that wasn't already crossed in Phase 56 (payload handling flows unchanged to `onOpenSessionInTree` / `onDropRowInTree` — those handlers already validated the payload trust boundary; this plan does not touch payload parsing).

## Next steps (Plan 57-03 preview — for orchestrator context, not this plan's scope)

Phase 57's core payload is now shipped in code + tests. The CONTEXT.md `<verification>` block mentions a manual visual smoke ("open the app in dev, drag a conv-list row over a Pane, watch the coral overlay snap between edges as the cursor moves") — this is the "Ashley can see where it will land" acceptance from CONTEXT.md §Vehicle Phase 2, verified live in orchestrator UAT, not in this executor's scope.

If Plan 57-03 lands (deferred visual tweaks + observability polish + any UAT-driven adjustments), it consumes:
- `overlayGeometryForZone` if a helper-level refactor becomes worthwhile (currently module-local; tests query DOM inline styles directly).
- The `[pv-split-preview]` and `[pv-split-drop]` log surfaces if new zone-transition or drop-outcome dimensions need capture.
- The `data-testid="pane-drop-preview-overlay"` + `data-zone={zone}` DOM contract if UAT tests want browser-driven zone assertions.
