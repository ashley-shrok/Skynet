# Phase 14 — Deferred Items

Log of out-of-scope discoveries during phase execution. Not blockers for the
current plan; NOT fixed by this executor per the scope-boundary rule.

## 2026-07-26 (during 14-02 execution)

### Pre-existing ComposeBox.test.tsx failures (2 tests)

Discovered while running the full vitest suite as a regression check after
Wave 2 backend + wire-type work landed. Both failures are in
`src/ui/features/pretty-view/ComposeBox.test.tsx` and relate to `getByLabelText(/send 'yes'/i)`
not finding an element — likely a stale test after a ComposeBox refactor.

**Reproduction:** `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx`
gives `2 failed | 18 passed` at commit `19ae23f` (BEFORE Wave 2 GREEN), so
these are unrelated to Phase 14 work.

**Deferred to:** Wave 4 (14-04, ComposeBox morph) is the natural touchpoint
for ComposeBox test upkeep — the morph plan will already be modifying this
file and can absorb the fix.

**Not fixed here** per executor scope-boundary rule (only auto-fix issues
DIRECTLY caused by the current task's changes).
