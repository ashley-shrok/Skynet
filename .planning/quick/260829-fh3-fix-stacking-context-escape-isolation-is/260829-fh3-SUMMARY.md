---
phase: quick-260829-fh3
plan: 01
subsystem: shell/split-view
tags: [css, stacking-context, isolate, tailwind-v4, patch-517, pretty-view, appshell, regression-test]
tech-stack:
  added: []
  patterns:
    - "Tailwind v4 `isolate` shorthand (`isolation: isolate`) on container wrappers to sandbox descendant z-index budgets — matches existing repo convention at features/pretty-view/SessionHoldingOverlay.tsx:133, PrettyViewLoadingOverlay.tsx:78, PrettyViewErrorOverlay.tsx:104, dialog.tsx:48."
    - "Regression tests that use loosened substring walkups (`flex flex-col`) plus whitespace-delimited standalone-token regex (`/(?:^|\\s)isolate(?:\\s|$)/`) to guard both presence AND correct-tokenization of a critical CSS class."
key-files:
  created:
    - src/ui/shell/SplitView.stacking-context.test.tsx
  modified:
    - src/ui/shell/SplitView.tsx
    - src/ui/shell/SplitView.test.tsx
decisions:
  - "Fix is a single class-token addition (`isolate`) on the Pane outer wrapper at SplitView.tsx:400, NOT any of the plausible alternatives (bumping AppShell zIndex:10, restructuring the AppShell layer gate, lowering PrettyView chrome z-indices, or adding `isolation:isolate` inline style). Class-token approach is cheapest, matches repo convention, and does not require touching any file that carries policy (AppShell/IdentityBadge/DropOverlay/SessionHoldingOverlay all untouched)."
  - "Load-bearing comment placed ABOVE the `<div ref={outerRef}>` so it is visible immediately at the class-site, and it explicitly enumerates the four escaping surfaces (IdentityBadge z-[101], SessionHoldingOverlay z-[99], DropOverlay z-[95], composebox close button) plus the AppShell zIndex:10 gate — a future refactor cannot silently drop `isolate` without confronting the why."
  - "Regression test uses whitespace-delimited standalone-token regex, not `toContain('isolate')`, so an accidental rename to `isolation-foo` or embedding into a longer class token would fail the guard. Belt-and-suspenders assertion `.not.toMatch(/isolation-/)` guards specifically against the Tailwind v3-style longhand `isolation-isolate` typo."
  - "Fixture walk in the new test file uses the loosened substring `flex flex-col` (not the pre-fix `relative flex flex-col`) so the walk is stable regardless of whether the token order between `relative` and `flex` shifts — the walk is a fixture-finder, not a token assertion; the token assertion is done separately."
  - "Two atomic commits (RED then GREEN) rather than one squashed commit, so the RED commit demonstrates the tests actually fail without the fix and the GREEN commit is a minimal, reviewable one-line CSS change plus the two mechanical walkup renames the className edit forces."
metrics:
  duration: "~80 minutes wall-clock (long tail attributable to sibling worktree `skynet-tina` running vitest concurrently, causing CPU contention — full-suite run took 4470s vs. a normal <5min)"
  completed: "2026-08-29"
  tasks_completed: 2
  files_touched: 3
  commits: 2
requirements-completed:
  - QUICK-FH3-01
---

# Quick task 260829-fh3: Fix stacking-context escape (isolate Pane wrapper) — Summary

Fix CSS stacking-context escape on the multi-view Pane wrapper so PrettyView's high-z
chrome (IdentityBadge z-[101], SessionHoldingOverlay z-[99], DropOverlay z-[95], composebox
close button) can no longer paint over AppShell's normal-view container (zIndex:10) when
the active tab lives outside the split tree. Achieved with a one-token Tailwind `isolate`
addition to the Pane outer wrapper, plus a load-bearing comment and a 3-test regression
suite. Motivated by the 2026-08-28 UAT trace under skynet-patches.md #517 handoff.

## The exact diff

### SplitView.tsx (className site — L400)

**Before:**
```tsx
return (
  <div
    ref={outerRef}
    className={`relative flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
      isFocused ? "ring-1 ring-inset ring-accent-brand/30" : ""
    }`}
    onClick={() => onPaneClick?.(tabId)}
  >
```

**After** (comment above + `isolate` inserted after `relative`):
```tsx
return (
  /* Patch #517 follow-up (quick-260829-fh3): `isolate` establishes a CSS
     stacking context on this Pane wrapper. Without it, PrettyView's
     high-z descendants — IdentityBadge (z-[101] at
     features/terminal/IdentityBadge.tsx:90), DropOverlay (z-[95]),
     SessionHoldingOverlay (z-[99]), and the composebox close button —
     are compared against the AppShell tree and beat the normal-view
     container's zIndex:10 (src/ui/AppShell.tsx:2552-2555) that is
     supposed to cover the split when the active tab is outside the
     split tree. 2026-08-28 UAT trace: ghost identity badge +
     composebox chrome hovering on top of an RDP surface after
     clicking a non-split-tree RDP session while a multi-view split
     was active. `isolate` (Tailwind v4 shorthand for
     `isolation: isolate`) contains that z-index budget inside the
     Pane. Regression test at SplitView.stacking-context.test.tsx.
     Do NOT remove without either (a) removing every z-[NN] > 10
     inside PrettyView chrome, or (b) restructuring the AppShell
     layer gate. Both are strictly larger changes. */
  <div
    ref={outerRef}
    className={`relative isolate flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
      isFocused ? "ring-1 ring-inset ring-accent-brand/30" : ""
    }`}
    onClick={() => onPaneClick?.(tabId)}
  >
```

### SplitView.test.tsx (walkup renames at L300 + L481)

Both `findPaneOuter` helpers (identical bodies, inside two separate `describe`
blocks — Phase 56 Plan 02 tests at L300 and Phase 56 Plan 03 tests at L481)
updated in the same edit that added `isolate` at the source-file site — the
substring `"relative flex flex-col"` those helpers matched no longer appears
contiguously in the className after `isolate` is inserted between `relative`
and `flex`.

**Before (L300 and L481, identical):**
```ts
while (cur && !cur.className.includes("relative flex flex-col")) {
```

**After (both sites):**
```ts
while (cur && !cur.className.includes("relative isolate flex flex-col")) {
```

Repo-wide grep confirms no other walkup on the old substring survives:
```
$ grep -rn '"relative flex flex-col"' src/
(no hits)
```

### SplitView.stacking-context.test.tsx (new, 159 lines, 3 tests)

Co-located regression suite. Mirrors the mock setup and fixture helpers from
SplitView.test.tsx (react-i18next passthrough shim, tabIcon "ICON" stub,
`makeTab`/`leaf`/`split` helpers).

- **Test A:** single-leaf `<SplitView>` → walk from `[data-tab-id]` up to
  Pane outer div → assert className matches `/(?:^|\s)isolate(?:\s|$)/`.
- **Test B:** horizontal split renders TWO `[data-tab-id]` nodes; BOTH walk
  to a Pane wrapper carrying `isolate` — proves the fix is applied
  uniformly at the Pane component definition, not per-instance.
- **Test C:** same setup as Test A, asserts `isolate` appears as a
  whitespace-delimited standalone class AND that the raw substring
  `isolation-` does NOT appear (belt-and-suspenders against a rename to
  the Tailwind v3-style longhand `isolation-isolate` typo or any other
  `isolation-foo` variant that would defeat `toContain("isolate")`).

Walk uses the loosened substring `"flex flex-col"` so the fixture-finder is
stable across the token-order edit; the actual `isolate` assertion happens
after the walk finds the wrapper.

## Task-by-task record

### Task 1: Add `isolate` to Pane wrapper + load-bearing comment + regression test

- **TDD:** RED first (test file committed asserting `isolate` present → all 3 tests
  fail with actual message `expected 'relative flex flex-col w-full h-full …' to
  match /(?:^|\s)isolate(?:\s|$)/`), then GREEN (className edit + comment + two
  walkup renames in the sibling test file, all in one atomic commit because the
  className token-order change forces the walkup rename in the same tree state).
- **Scoped verify:** `npx vitest run src/ui/shell/SplitView.stacking-context.test.tsx
  src/ui/shell/SplitView.test.tsx` → **29 passed / 0 failed** (26 pre-existing SplitView
  tests intact + 3 new stacking-context tests green).
- **Commits:**
  - `11ef10d6` — `test(quick-260829-fh3-01): failing regression for Pane stacking-context isolate` (RED — 1 file, +159 lines)
  - `aee16c8f` — `fix(quick-260829-fh3-01): isolate Pane wrapper's stacking context` (GREEN — 2 files, +20/-3 lines)

### Task 2: Full-suite regression check

- **Full-suite verify:** `npx vitest run` → **3109 passed / 2 failed / 10 skipped /
  1 todo, of 3122 total** (4470s wall-clock — see Deviations below).
- **Both failures in the same file** (`src/ui/sidebar/NewSessionDialog.test.tsx`):
  - Test G at L654-655 — documented pre-existing flake (mitigation at L657-661 with
    `{ timeout: 5000 }` sometimes still trips under heavy parallel load).
  - RTL-03 at L1579 — **undocumented sibling flake** with identical mechanics
    (`waitFor(() => expect(createBtn.disabled).toBe(false))` after a mocked
    async avatar candidate upload).
- **Isolated re-run:** `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` →
  **46 passed / 46** — confirms both failures are full-suite parallel-load flakes,
  not real bugs.
- **Zero coupling to the fix:**
  - `grep -c 'SplitView\|relative flex flex-col\|relative isolate flex flex-col'
    src/ui/sidebar/NewSessionDialog.test.tsx src/ui/sidebar/NewSessionDialog.tsx`
    → both files return `0` hits. Neither file imports SplitView nor uses the
    walkup substring.
- No source edit; verify-only task, no commit.

## Success criteria (all met)

- [x] `isolate` token appears as standalone class on Pane wrapper at
      `src/ui/shell/SplitView.tsx:417` (L400 shifted by +17 lines from the
      inserted comment; className site is a single hit repo-wide for
      `relative isolate flex flex-col`).
- [x] Patch #517 follow-up load-bearing comment present above the wrapper,
      citing z-[101], z-[99], z-[95], and AppShell zIndex:10 (4 required
      substring hits, verified via `grep -c` = 4).
- [x] Both ancestor walkups in `src/ui/shell/SplitView.test.tsx` at L300 and
      L481 (inside `findPaneOuter` helpers) updated from
      `"relative flex flex-col"` → `"relative isolate flex flex-col"`.
- [x] `src/ui/shell/SplitView.stacking-context.test.tsx` exists with 3 passing
      tests (159 lines, `it("Test A|B|C` × 3 blocks).
- [x] Scoped verify green: 29/29 pass.
- [x] Full suite: 3109 pass. **1 delta from expected 3110** — attributable
      entirely to a sibling NewSessionDialog waitFor flake (RTL-03) with
      identical mechanics to the documented Test G, both passing 46/46 in
      isolation. Not caused by the fix (zero coupling verified). See
      Deviations below.
- [x] Zero edits to AppShell.tsx, IdentityBadge.tsx, DropOverlay.tsx,
      SessionHoldingOverlay.tsx, or any composebox file (`git diff HEAD~2
      HEAD --stat` on those paths returns empty).

## Deviations from plan

### [Rule 1-adjacent — undocumented parallel-load flake surfaced, NOT auto-fixed]

**Found during:** Task 2 (full-suite verify).

**Issue:** The plan predicted exactly ONE permissible full-suite flake
(NewSessionDialog Test G at L657-661, documented). The actual full-suite run
surfaced TWO flakes, both in the same file (`src/ui/sidebar/NewSessionDialog.test.tsx`):
Test G (documented, L654) plus a previously-undocumented RTL-03 (L1551, failure
at the `waitFor` on L1579). Both share the same failure signature:
`waitFor(() => expect(createBtn.disabled).toBe(false))` timing out under heavy
parallel-suite load after a mocked async upload/avatar-selection promise
should have re-enabled the Create button.

**Investigation performed:**
1. Grepped repo-wide for the old walkup string `"relative flex flex-col"` per
   the plan's Task 2 instructions — ZERO hits, so the className token-order
   change has no missed walkup as leading suspect.
2. Grepped the failing test file and its subject for coupling to the fix
   (`SplitView`, `relative flex flex-col`, `relative isolate flex flex-col`)
   — ZERO hits in both `NewSessionDialog.test.tsx` and `NewSessionDialog.tsx`.
3. Re-ran the failing test file in isolation:
   `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx` → 46/46 pass.
   Confirms both failures are full-suite parallel-load flakes, not real bugs.

**Contributing environmental factor:** The full-suite run wall-clock was 4470s
(74 minutes vs. an expected <5min) because a sibling worktree `skynet-tina`
was running its own vitest concurrently on the same host, causing severe CPU
contention. Under normal single-worktree load the RTL-03 flake likely would
not have surfaced.

**Fix:** NOT applied within this task. The RTL-03 flake follows the exact
pattern already documented and mitigated for Test G (increase the waitFor
timeout from the vitest default 1000ms to 5000ms — see the existing
mitigation at L657-661 for Test G, adopting the `{ timeout: 5000 }`
convention). The one-line mitigation is orthogonal to the stacking-context
fix and belongs in its own patch. Recorded here for follow-up.

**Recommended follow-up patch (single line, not applied here):**
Add `{ timeout: 5000 }` to the `await waitFor(...)` call at
`src/ui/sidebar/NewSessionDialog.test.tsx:1577-1580` mirroring the mitigation
already in place at L652-661.

### [Documentation / orchestrator note]

The plan's baseline flake citation reads `src/ui/features/session/NewSessionDialog.test.tsx:657-661`
but the actual file lives at `src/ui/sidebar/NewSessionDialog.test.tsx:657-661` — a
stale path from an earlier layout. The line numbers and the flake description are
correct; only the directory is wrong. Not fixed in this task (out of scope for a
CSS presentation fix — the plan file is scaffolding; the orchestrator will handle
skynet-patches.md at ship time).

## Threat surface scan

Not applicable. The diff is a pure CSS presentation change (adding one Tailwind
class token + a load-bearing comment + two test-fixture walkup string renames +
one new test file). No new network I/O, no serialization change, no new input
surface, no privilege change, no trust-boundary shift. STRIDE categories
S/T/R/I/D/E all N/A. Zero threat flags.

## Known stubs

None. The Pane wrapper's other props/behavior are untouched; no data-source
placeholders introduced.

## Cross-references

- **skynet-patches.md #517 handoff** (2026-08-28 UAT trace): motivated this fix.
  Symptom captured: PrettyView identity badge + composebox close-button chrome
  ghost-painting on top of an RDP surface after clicking a non-split-tree RDP
  session while a multi-view split was active.
- **src/ui/AppShell.tsx:2491, 2552-2555**: normal-view container zIndex:10 layer
  gate — the layer the escaping high-z chrome was beating pre-fix.
- **src/ui/features/terminal/IdentityBadge.tsx:90**: `z-[101]` — the largest of
  the three escaping z-indices; the one visually most conspicuous in the UAT
  trace.
- **src/ui/features/pretty-view/SessionHoldingOverlay.tsx:133**: prior-art
  reference for the `isolate` convention adopted by this fix.
- **Comparable Tailwind `isolate` usages already in-repo** (naming-convention
  citations in the load-bearing comment): PrettyViewLoadingOverlay.tsx:78,
  PrettyViewErrorOverlay.tsx:104, dialog.tsx:48.

## Commit trail

| # | Hash       | Message                                                                                    | Files                                                                | Lines   |
| - | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------- |
| 1 | `11ef10d6` | test(quick-260829-fh3-01): failing regression for Pane stacking-context isolate            | src/ui/shell/SplitView.stacking-context.test.tsx (new)               | +159    |
| 2 | `aee16c8f` | fix(quick-260829-fh3-01): isolate Pane wrapper's stacking context                          | src/ui/shell/SplitView.tsx, src/ui/shell/SplitView.test.tsx          | +20/-3  |

Both commits landed on branch `feat/tab-title-from-tmux` on top of `0cca4d5c`.
No branch drift, no worktree, no force ops, no deletions of tracked files
(diff summary shows only content edits and one new file).

## Self-Check: PASSED

- Files created — verified present:
  - `src/ui/shell/SplitView.stacking-context.test.tsx` — FOUND (159 lines).
- Files modified — verified via git log:
  - `src/ui/shell/SplitView.tsx` — modified in `aee16c8f`.
  - `src/ui/shell/SplitView.test.tsx` — modified in `aee16c8f`.
- Commits exist — verified via git log:
  - `11ef10d6` FOUND (RED test commit).
  - `aee16c8f` FOUND (GREEN fix commit).
- Success-criteria greps — all 7 items verified (see Success Criteria section above).
- Forbidden-file diff — empty (zero edits to AppShell.tsx, IdentityBadge.tsx,
  DropOverlay.tsx, SessionHoldingOverlay.tsx, or any composebox file).
