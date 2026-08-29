---
phase: quick-260829-ih3
plan: 01
subsystem: shell/collapsed-panel-close-lane
tags: [drop-lane, split-view, identity-badge, close-target, coral, patch-517, shape-drop-lane-close-in-split-view, native-drag-listeners, isolation-isolate]
tech-stack:
  added: []
  patterns:
    - "Native DOM drag listeners via useEffect + ref (NOT React synthetic handlers) — patch #514 lesson that React synthetic drag events don't co-bubble through portal boundaries reliably. Mirrors SplitView.tsx:258-395 canonical shape."
    - "Coral grammar rule (Ashley 2026-08-29): coral color = 'hovering a valid drop target NOW' (hover state). Baseline lane is NEUTRAL, not coral — same rule every drop target in the app already followed (SplitView, PrettyConversationsPanel, AppShell empty-PV). Tests B + D enforce."
    - "Stacking-context sandbox: `isolation: isolate` (inline style) on the lane's outer wrapper to prevent the coral hover state's z-index budget from escaping past AppShell layer gates. Mirrors quick-260829-fh3 pattern at SplitView.tsx:417."
    - "Palette exactness: coral fill + border byte-for-byte match with SplitView.tsx:463-464 and AppShell.tsx:2482-2483 — no new palette values introduced. Neutral baseline uses existing tokens `var(--color-pv-base)` + `var(--color-pv-border-quiet-strong)` (index.css:143, 155)."
    - "Drop-ladder security discipline mirrors PrettyConversationsPanel.tsx:1368-1412 verbatim: getData → empty→return → JSON.parse in try/catch → shape validation → openTabIds.includes check → preventDefault + stopPropagation → structured log → callback. Silent-drop on any guard miss; log ONLY on the successful-close branch."
    - "Window-level dragend cleanup — Escape-cancel path (mirror SplitView.tsx:378-381 + PrettyConversationsPanel.tsx:1311-1322). Idempotent."
    - "Colocated hook `useDraggedBadgeTabId` in the same source file as the component — no state spread across the codebase. Feeds the mount gate in AppShell with the current badge-drag tabId (or null)."
key-files:
  created:
    - src/ui/shell/CollapsedPanelCloseLane.tsx
    - src/ui/shell/CollapsedPanelCloseLane.test.tsx
  modified:
    - src/ui/AppShell.tsx
decisions:
  - "Mount site: option (a) from PLAN.md Task 2 <action>. The lane mounts INSIDE the main-content column at AppShell.tsx:2253 (already `relative flex flex-col flex-1 min-w-0 overflow-hidden`, so the lane's `position: absolute; left: 0` anchors correctly) but OUTSIDE the inner :2291 wrapper that owns the empty-PV drop-tint handlers. Rationale: the lane's absolute-positioned coral hover state cannot compete with PrettyView drop targets that live one nesting-level deeper. Smallest surgery — no new `position: relative` wrapper needed anywhere."
  - "Test suite ships 11 tests (A, B, C, D, E, F, G, H, I, J, J.2) rather than the planned 10. Test J.2 is a bonus row-drag exclusion assertion on `useDraggedBadgeTabId` (dragstart with ONLY text/plain must leave the hook returning null). Same test scaffold, one additional dispatch, zero cost — and it locks in the semantic-crossing guard for the hook path the way Test D locks it in for the component path."
  - "Test C uses regex `/rgba\\(255, 184, 150, 0\\.60?\\)/` rather than substring `rgba(255, 184, 150, 0.60)` because jsdom's CSS serializer normalizes `0.60` in the source to `0.6` in the runtime style attribute. The SOURCE token in CollapsedPanelCloseLane.tsx is verbatim `rgba(255, 184, 150, 0.60)` — palette-exactness grep in the PLAN.md <done> block still asserts this (returns 2 hits: JSDoc header comment + inline style object). The regex-vs-substring choice ONLY affects the runtime-string assertion; the source-token assertion is unchanged."
  - "Coral hover style repeated inline (baseline branch + hover branch as two separate CSSProperties objects) rather than merged via spread. Two reasons: (a) the branches differ by more than just fill/border — the baseline uses `borderRight: 1px solid var(...)` while hover uses `border: 2px solid rgba(...)` — so a spread merge would leave conflicting border shorthand + longhand entries; (b) both branches keep all layout properties (top/bottom/left/width/zIndex/isolation/transform/transition/display/alignItems/justifyContent) inline so a reader sees the FULL style at each branch site without a mental spread — matches AppShell.tsx:2481-2486 palette convention exactly."
  - "Three atomic commits (RED test file, GREEN source file, AppShell wire) rather than a single squashed commit — matches quick-260829-fh3 TDD discipline. The RED commit demonstrates the tests actually fail without the source file (module-not-found), the GREEN commit is a minimal implementation, and the wire commit is a strictly additive AppShell.tsx edit with zero touches to forbidden files (PrettyConversationsPanel / IdentityBadge / SplitView)."
metrics:
  duration: "~54 minutes wall-clock (2560s full-suite verify long tail — see Deviations; parallel-agent CPU contention same as documented at quick-260829-fh3 SUMMARY)"
  completed: "2026-08-29"
  tasks_completed: 2
  files_touched: 3
  commits: 3
  tests_added: 11
requirements-completed:
  - QUICK-IH3-01
---

# Quick task 260829-ih3: CollapsedPanelCloseLane — Summary

Implement the collapsed-panel drop-lane close-target for split view per the frozen shape at
`.planning/shapes/shape-drop-lane-close-in-split-view.md`. A ~115px vertical lane slides in
from the left edge during an identity-badge drag when the conv-list panel is collapsed,
standing in as a badge drop-to-close target. Neutral baseline (matches the app's chrome),
coral-on-hover (matches every other drop target's hover semantic), single centered `X` glyph,
closes the dragged tab on drop.

Motivated by the follow-on to patch #517 — closing a session from split view when the panel
is collapsed previously required reopening the panel first, a two-motion gesture. The lane
makes it one motion, without dragging the panel open (which would compete with
row-drop-to-open semantics).

## The exact diff

### `src/ui/shell/CollapsedPanelCloseLane.tsx` (new, 301 lines)

New default-export component + colocated named-export hook:

**`CollapsedPanelCloseLane` (default export)**
- Props: `{ draggedBadgeTabId: string | null, openTabIds: string[], onCloseTab: (tabId: string) => void }`.
- Returns `null` when `draggedBadgeTabId === null` (own gate).
- When non-null renders an absolutely-positioned `<div>` pinned to the left edge:
  `position: absolute; top: 0; bottom: 0; left: 0; width: 115px; zIndex: 30; isolation: isolate`.
- Baseline (hover=false): NEUTRAL — `background: var(--color-pv-base)` +
  `borderRight: 1px solid var(--color-pv-border-quiet-strong)` + centered `X` (lucide, 28px, color `var(--color-pv-fg)`).
- Hover (dragover of `application/x-skynet-badge` MIME): CORAL — `background: rgba(255, 184, 150, 0.22)` +
  `border: 2px solid rgba(255, 184, 150, 0.60)` (byte-for-byte match with SplitView.tsx:463-464
  and AppShell.tsx:2482-2483).
- Slide-in via `transform: translateX(0)` + `transition: transform 150ms ease`.
  Instant disappear (no exit animation — parent gate unmounts on null).
- Native DOM listeners via `useEffect` on `outerRef`, deps `[openTabIds, onCloseTab]`:
  - `dragover`: type-gate on `application/x-skynet-badge` → preventDefault + stopPropagation + setHover(true).
    Row drags (text/plain only) and OS file drags fall through — Test D asserts.
  - `dragleave`: type-gate FIRST → bounding-rect stateless guard (mirror SplitView.tsx:301-305) →
    setHover(false) only when cursor is OUTSIDE the rect. Test G asserts inside-guard.
  - `drop`: setHover(false) FIRST (defensive-clear) → 7-step ladder mirroring
    PrettyConversationsPanel.tsx:1368-1412 (`getData` → empty→return → JSON.parse in try/catch →
    shape validation → openTabIds.includes → preventDefault + stopPropagation → structured log
    `[collapsed-lane-drop] close tabId=${tabId}` → `onCloseTab(tabId)`).
  - Window-level `dragend`: unconditional setHover(false) — Escape-cancel path (Test H).
- `data-testid="collapsed-panel-close-lane"` + `data-hover="true|false"` — tests assert without
  parsing inline-style strings.

**`useDraggedBadgeTabId` (named export)**
- Returns `string | null`.
- `useState<string | null>(null)` + `useEffect` attaching window `dragstart` + `dragend`.
- `dragstart`: type-gate on `application/x-skynet-badge` → parse the badge JSON payload in
  try/catch → validate shape → setState(tabId). Row drags (text/plain only) leave state at
  null — Test J.2 asserts.
- `dragend`: unconditional setState(null).

### `src/ui/shell/CollapsedPanelCloseLane.test.tsx` (new, 431 lines, 11 tests)

Regression suite mirroring `AppShell.empty-pv-drop-tint.test.tsx` scaffold shape verbatim:
`makeDataTransferStub` (Map-backed DataTransfer with types + getData), `dispatchDragLeaveAt`
(createEvent.dragLeave + Object.defineProperty for clientX/Y — jsdom's DragEvent constructor
ignores those in its init dict), `KNOWN_RECT` + `HTMLElement.prototype.getBoundingClientRect`
override in beforeEach / restore in afterEach.

Because the lane wires drag listeners natively (useEffect + ref, patch #514 lesson), the test
file adds three sibling dispatchers — `dispatchNativeDragOver`, `dispatchNativeDrop`,
`dispatchNativeDragLeaveAt` — that build raw DOM `Event('dragover'|'drop'|'dragleave')`
instances and patch `dataTransfer` + `clientX`/`clientY` via `Object.defineProperty` before
`el.dispatchEvent(evt)`. `fireEvent.dragOver` (which walks React's synthetic event path) would
NEVER wake the native handler; this was the load-bearing insight.

Tests:
- **A**: `draggedBadgeTabId === null` → component returns null.
- **B**: `draggedBadgeTabId='tab-alice-1'` → lane rendered, `data-hover="false"`,
  inline style contains `var(--color-pv-base)`, does NOT contain `rgba(255, 184, 150,`.
- **C**: dragover with `application/x-skynet-badge` → `data-hover="true"` + coral palette
  present in inline style (asserted via regex `/rgba\(255, 184, 150, 0\.60?\)/` to
  accommodate jsdom's `0.60` → `0.6` normalization; source token is verbatim `0.60`).
- **D**: dragover with ONLY text/plain (row drag) → `data-hover` stays `"false"`, palette
  stays neutral. Semantic-crossing guard from the shape file.
- **E**: dragover + drop with valid badge payload matching an openTabId → `onCloseTab`
  called EXACTLY once with the correct tabId, `data-hover` cleared, structured log
  `[collapsed-lane-drop] close tabId=tab-alice-1` emitted exactly once.
- **F**: drop with badge payload tabId NOT in `openTabIds` → `onCloseTab` NOT called
  (silent-drop, T-260829-ih3-01), NO structured log, `data-hover` cleared.
- **G**: dragover then dragleave INSIDE bounding rect → `data-hover` STAYS `"true"`
  (child-boundary crossing guard).
- **H**: dragover then window-level dragend (Escape-cancel simulation) → `data-hover`
  cleared without a preceding dragleave.
- **I**: mount-gate integration — `draggedBadgeTabId` null → 'tab-x' → null cycles lane
  in/out of the DOM (instant disappear on the second null transition).
- **J**: `useDraggedBadgeTabId` hook — dragstart with badge MIME sets probe text to
  `'tab-alice-1'`; dragend clears to empty.
- **J.2**: bonus — dragstart WITH ONLY text/plain (row-drag simulation) leaves probe empty.
  Row drags MUST NOT setState the hook.

### `src/ui/AppShell.tsx` (modified, +32 lines total)

Three additive edits:

1. **Import** (~L24, sibling to `import { SplitView }`):
   ```tsx
   // quick-260829-ih3: CollapsedPanelCloseLane — proxy close-target lane that
   // stands in for the PrettyConversationsPanel during a badge drag when the
   // sidebar is closed. See .planning/shapes/shape-drop-lane-close-in-split-view.md.
   import CollapsedPanelCloseLane, {
     useDraggedBadgeTabId,
   } from "@/shell/CollapsedPanelCloseLane";
   ```

2. **Hook call** (~L331, grouped with `useIsMobile` / `useIsTouchDevice` / `useIdentities`):
   ```tsx
   const draggedBadgeTabId = useDraggedBadgeTabId();
   ```
   With a header comment pointing at IdentityBadge's dragstart payload contract.

3. **Mount** (~L2282, inserted inside the `:2253` main-content column, before the `:2291`
   inner wrapper):
   ```tsx
   {!isMobile && !isMobileListScreen && !sidebarOpen && (
     <CollapsedPanelCloseLane
       draggedBadgeTabId={draggedBadgeTabId}
       openTabIds={tabs.map((t) => t.id)}
       onCloseTab={closeTab}
     />
   )}
   ```
   With a load-bearing block comment above enumerating the three suppression rules and
   explaining the mount-site choice (option (a) from PLAN.md — the :2253 column is already
   `relative`, so the lane's `position: absolute; left: 0` anchors correctly, and mounting
   outside the :2291 wrapper means the lane doesn't compete with the empty-PV drop-tint
   handlers).

Zero touches to `PrettyConversationsPanel.tsx`, `IdentityBadge.tsx`, `SplitView.tsx` —
verified via `git diff --stat HEAD~3 HEAD -- src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/features/terminal/IdentityBadge.tsx src/ui/shell/SplitView.tsx` returns empty.

## Task-by-task record

### Task 1: Create CollapsedPanelCloseLane component + colocated hook + regression test suite (TDD)

- **RED commit** (`d051b0b3`): test file authored with all 11 tests (A, B, C, D, E, F, G, H, I, J, J.2)
  and no source file. `npx vitest run src/ui/shell/CollapsedPanelCloseLane.test.tsx` fails
  at import-resolve time (`Error: Failed to resolve import "./CollapsedPanelCloseLane"`).
  Test collection reports "Test Files 1 failed (1) — Tests no tests". RED confirmed.
- **GREEN commit** (`429802f8`): source file added implementing component + hook per
  behavior spec. Rerun scoped verify → 10/11 pass on first attempt; Test C fails on the
  jsdom `0.60` → `0.6` serialization quirk. Regex tweak on the test (`/0\.60?\)/`
  vs substring) fixed the assertion without changing the SOURCE token. Rerun → 11/11 pass.
  Both fixes committed together (test tweak is part of the GREEN's authoring iteration —
  no separate RED-2 needed since the source palette was correct throughout; only the
  test's runtime-serialization matcher was too strict).
- **Scoped verify:** `npx vitest run src/ui/shell/CollapsedPanelCloseLane.test.tsx`
  → **11 passed / 0 failed** (8.45s isolated).
- **Palette + baseline + isolate greps (PLAN.md <done>):**
  - `grep -c 'rgba(255, 184, 150, 0.22)' src/ui/shell/CollapsedPanelCloseLane.tsx` → 2 (>=1 ✓; JSDoc + style)
  - `grep -c 'rgba(255, 184, 150, 0.60)' src/ui/shell/CollapsedPanelCloseLane.tsx` → 2 (>=1 ✓)
  - `grep -c 'var(--color-pv-base)' src/ui/shell/CollapsedPanelCloseLane.tsx` → 2 (>=1 ✓)
  - `grep -c 'var(--color-pv-border-quiet-strong)' src/ui/shell/CollapsedPanelCloseLane.tsx` → 2 (>=1 ✓)
  - `grep -cE 'isolation:\s*.?isolate|\bisolate\b' src/ui/shell/CollapsedPanelCloseLane.tsx` → 4 (>=1 ✓)

### Task 2: Wire CollapsedPanelCloseLane into AppShell (mount + hook); full-suite regression verify

- **Wire commit** (`1c8e3b6d`): 3 additive edits to AppShell.tsx (import + hook call +
  mount), zero code deleted, zero other files touched.
- **Wire greps (PLAN.md <done>):**
  - `grep -c 'CollapsedPanelCloseLane' src/ui/AppShell.tsx` → 6 (>=3 ✓; import name, import path, hook module, mount tag, closing tag, header comment)
  - `grep -cE '!isMobile && !isMobileListScreen && !sidebarOpen' src/ui/AppShell.tsx` → 1 (>=1 ✓; exact mount gate)
  - `grep -cE 'onCloseTab=\{closeTab\}' src/ui/AppShell.tsx` → 1 (>=1 ✓)
  - `grep -cE 'openTabIds=\{tabs\.map' src/ui/AppShell.tsx` → 2 (>=1 ✓; sibling wire at :1919 to PrettyConversationsPanel is the other hit)
- **Forbidden-file diff** (`git diff --stat HEAD~3 HEAD -- src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/features/terminal/IdentityBadge.tsx src/ui/shell/SplitView.tsx`)
  → **empty** (zero touches).
- **Scoped verify** (`npx vitest run src/ui/shell/CollapsedPanelCloseLane.test.tsx
  src/ui/AppShell.empty-pv-drop-tint.test.tsx src/ui/shell/SplitView.stacking-context.test.tsx
  src/ui/shell/SplitView.test.tsx`)
  → **Test Files 4 passed (4) — Tests 48 passed (48)** (48.17s).
  Composition: 11 CollapsedPanelCloseLane + 8 empty-PV + 3 stacking-context + 26 SplitView main = 48.
- **Full-suite verify** (`npx vitest run`)
  → **Test Files 1 failed | 218 passed (219) — Tests 1 failed | 3121 passed | 10 skipped | 1 todo (3133)** (2560s wall-clock — see Deviations).

## Success criteria (all met)

- [x] Component `CollapsedPanelCloseLane` shipped in `src/ui/shell/CollapsedPanelCloseLane.tsx`
      (default export + colocated named export `useDraggedBadgeTabId`).
- [x] Regression suite `src/ui/shell/CollapsedPanelCloseLane.test.tsx` covers 11 tests
      (A-J + J.2), all passing.
- [x] AppShell.tsx wire is exactly one import + one hook call + one mount block gated
      `!isMobile && !isMobileListScreen && !sidebarOpen`, passing `closeTab` and
      `tabs.map(t => t.id)` mirroring the panel-drop wire at :1919.
- [x] Coral palette values byte-for-byte match SplitView.tsx:463-464 and AppShell.tsx:2482-2483.
      No new palette values introduced.
- [x] Baseline treatment is NEUTRAL (`var(--color-pv-base)` fill + `var(--color-pv-border-quiet-strong)`
      right-edge border + centered lucide `X`). Lane NEVER paints coral at rest — Tests B + D
      + C together enforce the neutral-baseline / hover-only-on-badge-dragover contract.
- [x] Lane is SUPPRESSED under all three exclusion cases (mobile / mobile-list-screen /
      sidebar-open) via the parent mount gate.
- [x] Escape-cancel handled via window-level dragend listener — Test H.
- [x] Wrapper carries `isolation: isolate` (stacking-context sandbox — mirror quick-260829-fh3
      lesson at SplitView.tsx:417). Applied inline (not via Tailwind class) to keep the
      whole palette one-grep-verifiable in source.
- [x] Native DOM drag listeners (not React synthetic) — patch #514 lesson. `useEffect` +
      `outerRef` deps `[openTabIds, onCloseTab]`.
- [x] Forbidden files untouched: PrettyConversationsPanel.tsx, IdentityBadge.tsx, SplitView.tsx
      (`git diff --stat HEAD~3 HEAD -- <paths>` returns empty).
- [x] Full suite: **3121 pass** (planned 3120 = 3109 baseline + 11 new). **+1 delta** vs.
      the plan's predicted 3120 — attributable to ONE of the two documented pre-existing
      NewSessionDialog waitFor flakes actually passing this run instead of flaking. See
      Deviations below.
- [x] Three atomic commits (Task 1 RED, Task 1 GREEN, Task 2 wire), in order, on
      `feat/tab-title-from-tmux` on top of `ebda9fb3`. `git log --oneline -3` confirms.

## Deviations from plan

### [Rule 1-adjacent — sibling parallel-load flake surfaced, NOT auto-fixed]

**Found during:** Task 2 (full-suite verify).

**Issue:** The plan expected the full-suite baseline of 3109 pass + 2 pre-existing
`NewSessionDialog.test.tsx` waitFor flakes (documented at
`.planning/quick/260829-fh3-fix-stacking-context-escape-isolation-is/260829-fh3-SUMMARY.md`),
predicting a post-fix count of `3109 + 11 = 3120 pass / 2 flakes` on this run. The
actual result was `3121 pass / 1 flake`, and the ONE flake that DID surface was in a
**different file** — `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx:219` — same
mechanism: a `waitFor(() => expect(select.value).toBe("tina"))` timing out under
full-suite parallel-load CPU contention.

**Investigation performed:**
1. Grepped the failing test file + subject for coupling to the fix:
   `grep -cE "CollapsedPanelCloseLane|application/x-skynet-badge|useDraggedBadgeTabId|closeTab" src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx src/ui/sidebar/NewSessionDialog.tsx`
   → **0 hits in each file**. Zero coupling to the CollapsedPanelCloseLane fix.
2. Reviewed the test source: `NewSessionDialog.role-dropdown.test.tsx:194-235` (Test 22)
   already carries in-file mitigation comments citing `quick 260809-ih9` and
   `patch #370` — it has been hardened for this exact flake pattern (waitFor timeouts
   raised from default 1000ms to 15000ms + `it()` timeout at 20000ms). The flake is
   pre-existing and known.
3. Re-ran the failing file in isolation twice:
   - Run 1 (immediately after full-suite): **1 failed / 7 passed / 8 total** —
     still failed on the same waitFor. The CPU-contention artifact persisted briefly.
   - Run 2 (60s later): **8 passed / 8** — full green. Confirms flake, not real bug.
4. Cross-referenced with the fh3 SUMMARY's Deviations block (which documented an
   `RTL-03` waitFor flake in `NewSessionDialog.test.tsx:1579` under the exact same
   mechanism). The new flake in `role-dropdown.test.tsx:219` is a THIRD test in the
   NewSessionDialog family with identical waitFor mechanics, and the whole family
   is CI-load-flaky in a documented pattern.

**Contributing environmental factor:** The full-suite run wall-clock was **2560s
(~43 minutes)** vs. the fh3 SUMMARY's baseline `<5 min` normal-load expectation.
`ps aux --sort=-%cpu` at 22 min into the run showed:
  - `agent-supervisor / parent claude` (this session): 14% CPU
  - Sibling claude sessions: 9.6% + smaller
  - `starter.js` backend: 23%
  - Vitest fork worker: 26%
Same parallel-agent-CPU-contention pattern documented at
`260829-fh3-SUMMARY.md` L219-223. Under normal single-agent load the flake
likely would not have surfaced.

**Fix:** NOT applied within this task. The flake fits an in-repo pattern with a
known one-line mitigation (raise the waitFor timeout further, or promote the test
to `it.retry(2)`). Either mitigation is orthogonal to the drop-lane feature and
belongs in a dedicated flake-fix patch. Recorded here for follow-up.

**Recommended follow-up patch (single line, not applied here):**
Either (a) raise the `waitFor` timeout at `NewSessionDialog.role-dropdown.test.tsx:216-220`
from `15000ms` to `30000ms` mirroring the escalation Ashley approved for the
`NewSessionDialog.test.tsx` L654 / L1579 flakes documented at fh3-SUMMARY, or (b)
promote Test 22 to `it.retry(2, ...)` if the vitest config permits.

**Net delta accounting:**
- Baseline (fh3 SUMMARY): 3109 pass / 2 fail (both in NewSessionDialog.test.tsx)
- Expected post-fix: 3120 pass / 2 fail (baseline + 11 new tests)
- Actual: 3121 pass / 1 fail (baseline's 2 flakes → 1 passed and 1 didn't; a third
  sibling flake surfaced in NewSessionDialog.role-dropdown.test.tsx)
- Grand total not-skipped-not-todo: 3122 in both expected and actual. All 11 new tests
  landed and passed. Zero coupling of the failure to the fix. No regression.

## Threat surface scan

Applied all mitigations from PLAN.md `<threat_model>` and verified via tests:

| Threat ID       | Mitigation                                                                                              | Test evidence |
|-----------------|---------------------------------------------------------------------------------------------------------|---------------|
| T-260829-ih3-01 | `openTabIds.includes(tabId)` guard in the drop ladder — silent-drop on miss.                            | Test F        |
| T-260829-ih3-02 | `JSON.parse` in try/catch — malformed payload silently drops without throwing.                          | (implicit in ladder; malformed-payload tests deferred as low-value — the guard is a 3-line try/catch identical to PrettyConversationsPanel.tsx:1384-1388) |
| T-260829-ih3-03 | Structured log `[collapsed-lane-drop] close tabId=${tabId}` ONLY on successful-close branch — no JSON.stringify(event). | Test E (exactly-once emit) + Test F (zero emit on silent-drop) |
| T-260829-ih3-04 | `dragover` handler type-gates on `application/x-skynet-badge` BEFORE `preventDefault`. Non-badge drags see no side-effect. | Test D |
| T-260829-ih3-05 | Outer wrapper carries `isolation: isolate` (inline style). Coral hover state's z-index budget sandboxed. | Palette-exactness grep + isolation grep (both PLAN.md <done>) |
| T-260829-ih3-SC | No new dependencies added. `lucide-react` already installed (EditableFileModal.tsx:2, DeactivateAction.tsx:42). No package-legitimacy gate. | `git diff --stat HEAD~3 HEAD -- package.json package-lock.json` → empty. |

**No new threat flags introduced.** The diff is a strictly-additive UI component (new
DOM surface, no new network I/O, no serialization change, no new input surface, no
privilege change, no trust-boundary shift). The one new consumer of an
attacker-controlled input (`e.dataTransfer.getData("application/x-skynet-badge")`) is
guarded by the same 7-step ladder shipped for PrettyConversationsPanel's badge-drop
close in Phase 58 Plan 02 — same shape, same guards, same silent-drop discipline.

## Known stubs

None. The component consumes real state (`draggedBadgeTabId` from the live hook,
`openTabIds` from the live `tabs` array in AppShell, `onCloseTab` = the real `closeTab`
routine at AppShell.tsx:1553). No mock data, no placeholder callback, no deferred
wiring.

## Cross-references

- **`.planning/shapes/shape-drop-lane-close-in-split-view.md`** — the frozen shape file.
  Source of truth for surface behavior, coral grammar rule, suppression rules, and
  scope edges. This SUMMARY is the ship record for the vehicle the shape called for.
- **`.planning/quick/260829-fh3-fix-stacking-context-escape-isolation-is/260829-fh3-SUMMARY.md`** —
  the prior quick task whose `isolate` sandbox pattern this feature reuses on the
  lane's outer wrapper. Also documents the NewSessionDialog waitFor-flake family that
  contributed the one non-fix failure this run surfaced.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1280-1412`** —
  the Phase 58 Plan 02 badge-drop close ladder this feature's drop handler mirrors
  verbatim (7-step guard chain, structured log discipline, silent-drop semantics).
  Untouched by this task.
- **`src/ui/features/terminal/IdentityBadge.tsx:145-172`** — the dragstart source for
  the `application/x-skynet-badge` MIME payload the lane consumes. Untouched by this task.
- **`src/ui/shell/SplitView.tsx:258-395`** — canonical shape for native-DOM drag
  listener attachment via useEffect + ref (patch #514 lesson). Mirrored in
  CollapsedPanelCloseLane. Untouched by this task.
- **`src/ui/shell/SplitView.tsx:417`** — the sibling `isolate` sandbox added by
  quick-260829-fh3, matching the pattern reused on the lane wrapper. Untouched by this task.
- **`src/ui/AppShell.tsx:1913-1914`** — the `onCloseSession={closeTab}` +
  `openTabIds={tabs.map(t => t.id)}` panel-drop wire this feature's lane wire mirrors
  exactly. Modified only by insertion (import + hook + mount); the panel wire itself
  is untouched.
- **`src/ui/AppShell.empty-pv-drop-tint.test.tsx`** — Phase 59 Plan 01 test scaffold
  whose `makeDataTransferStub` / `dispatchDragLeaveAt` / `KNOWN_RECT` pattern this
  SUMMARY's test file mirrors verbatim.
- **skynet-patches.md #517** — the patch this quick task ships as a follow-on
  (drop-lane close-target completes the coral drop-target affordance work started
  on the day before this shape opened).

## Commit trail

| # | Hash       | Message                                                                                    | Files                                                                             | Lines    |
| - | ---------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------- |
| 1 | `d051b0b3` | test(quick-260829-ih3-01): failing regression suite for CollapsedPanelCloseLane            | src/ui/shell/CollapsedPanelCloseLane.test.tsx (new)                               | +426     |
| 2 | `429802f8` | feat(quick-260829-ih3-01): CollapsedPanelCloseLane component + useDraggedBadgeTabId hook   | src/ui/shell/CollapsedPanelCloseLane.tsx (new), src/ui/shell/CollapsedPanelCloseLane.test.tsx (test C tweak) | +307/-1  |
| 3 | `1c8e3b6d` | feat(quick-260829-ih3-01): wire CollapsedPanelCloseLane into AppShell (mount + hook)       | src/ui/AppShell.tsx                                                               | +32      |

All three commits landed on branch `feat/tab-title-from-tmux` on top of `ebda9fb3`.
No branch drift, no worktree, no force ops, no deletions of tracked files
(`git diff HEAD~3 HEAD --stat` shows only content edits, one new source file, and
one new test file — no `D` mode).

## Self-Check: PASSED

- **Files created — verified present:**
  - `src/ui/shell/CollapsedPanelCloseLane.tsx` — FOUND (301 lines).
  - `src/ui/shell/CollapsedPanelCloseLane.test.tsx` — FOUND (431 lines).
- **Files modified — verified via git log:**
  - `src/ui/AppShell.tsx` — modified in `1c8e3b6d` (+32 lines, no deletions).
- **Commits exist — verified via `git log --oneline -5`:**
  - `d051b0b3` FOUND (RED test commit).
  - `429802f8` FOUND (GREEN feat commit).
  - `1c8e3b6d` FOUND (wire commit).
- **Success-criteria greps — all verified** (see Success Criteria section above).
- **Forbidden-file diff — empty** (`git diff --stat HEAD~3 HEAD -- src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/features/terminal/IdentityBadge.tsx src/ui/shell/SplitView.tsx` returns no lines).
- **Full-suite delta accounted:** +1 pass, -1 fail vs. plan prediction; +11 tests added,
  all passing; the one flake surfaced is in a THIRD NewSessionDialog waitFor sibling
  with zero coupling to the fix (confirmed via `grep -cE "CollapsedPanelCloseLane|application/x-skynet-badge|useDraggedBadgeTabId|closeTab" <failing-file> <subject>` → 0/0 hits, and via isolated re-run passing 8/8).
