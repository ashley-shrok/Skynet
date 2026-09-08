---
phase: 88-create-agent-modal-ux-pass-paired-header-blurbs-path-admin-g
plan: 01
subsystem: ui-sidebar-dialog + backend-identity-birth
tags: [foundation, admin-gate, prop-plumbing, backend-default-substitution, wave-1]
dependency_graph:
  requires:
    - "Phase 84 admin-gate pattern at PrettyConversationsPanel.tsx:1651 + L285"
    - "Phase 86 Plan 86-04 empty-⇒-default idiom at identity-birth.ts L213-214 (parsedTitle) / L218-221 (parsedAvatarCandidateId)"
  provides:
    - "NewSessionDialog `isAdmin?: boolean` prop with fail-closed default `false`"
    - "PrettyConversationsPanel forwards `isAdmin={isAdmin}` to <NewSessionDialog>"
    - "identity-birth.ts parsedPath narrow substitutes `~/<name>/` when body.path is empty or absent"
  affects:
    - "Unblocks Plan 88-02 admin-gated JSX wrappers on Path field + shell checkbox + submit-onclick invariant"
    - "Unblocks Plan 88-03 tests that pass `isAdmin={true|false}` explicitly + assert backend substitution"
tech-stack:
  added: []
  patterns:
    - "Fail-closed default at destructuring (isAdmin = false)"
    - "Backend empty-⇒-default narrow extension (mirrors Phase 86 L213-214 idiom)"
key-files:
  created: []
  modified:
    - src/ui/sidebar/NewSessionDialog.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/backend/database/routes/identity-birth.ts
decisions:
  - "Backend seam picked over frontend for path default substitution — extends the already-established L213-214 / L218-221 Phase 86 empty-⇒-default idiom at the same seam. Wire contract stays: BirthRequest `path: string` remains, empty-string is a valid value the backend handles gracefully."
  - "Prop name `isAdmin` matches PrettyConversationsPanel.tsx L285 / AppShell.tsx L2025 / WeeklyUsageMeter L1651 chain. No rename considered."
  - "No admin-gated JSX added in Plan 88-01 — that's Plan 88-02's surface. Prop is dormant until wave 2 consumes it."
metrics:
  duration: ~15 min
  tasks_completed: 2
  files_modified: 3
  completed_date: 2026-09-08
---

# Phase 88 Plan 01: Foundation — isAdmin prop + backend path default Summary

**Wave 1 of 3.** Threads a fail-closed `isAdmin?: boolean` prop through `PrettyConversationsPanel` → `NewSessionDialog`, and extends `identity-birth.ts`'s `parsedPath` narrow to substitute `~/<name>/` when the request body path is empty or absent — mirroring the Phase 86 L213-214 empty-⇒-default idiom.

## What Shipped

### Task 1 — Frontend prop plumbing (commit `9eb60747`)

- **`src/ui/sidebar/NewSessionDialog.tsx`**
  - Destructure at L277-285 gains `isAdmin = false,` as the final entry after `initialBrief: _initialBrief,`. Fail-closed default = when the caller forgets to pass the prop, non-admin behavior applies.
  - Inline type block at L285-338 gains `isAdmin?: boolean;` as the final entry, preceded by a JSDoc block anchoring on "Phase 88", "fail-closed", and "PrettyConversationsPanel.tsx L285" (the source-of-truth for the destructured prop) so grep-based verification lands. JSDoc also names the two Plan 88-02 consumers (Path field admin-gate at L926-942, checkbox admin-gate at L944-960) so future readers see the wire the prop is threading.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`**
  - `<NewSessionDialog>` render at L1935-1959 gains one attribute `isAdmin={isAdmin}` with a one-line Phase 88 comment. The `isAdmin` identifier is already in scope (destructured at L285 with the same `= false` fail-closed default, consumed at L1651 for `<WeeklyUsageMeter />`).
  - CreateRoleDialog render at L1968-1981 **UNCHANGED** — CreateRoleDialog is admin-only-visible upstream anyway; Phase 88 is the first bounty to introduce admin-gating INSIDE a dialog and only NewSessionDialog needs the prop.

### Task 2 — Backend parsedPath narrow extension (commit `873c73dd`)

- **`src/backend/database/routes/identity-birth.ts`**
  - Replaces the single-line narrow at L206:
    ```ts
    const parsedPath = (typeof path === "string" ? path : "~") as string;
    ```
    with a multi-line empty-⇒-default narrow preceded by a Phase 88 comment block:
    ```ts
    const parsedPath = (
      typeof path === "string" && path.trim()
        ? path
        : `~/${(typeof name === "string" ? name.trim().toLowerCase() : "")}/`
    ) as string;
    ```
  - The `.trim()` predicate covers three "empty" cases in one branch: `path === ""`, `path === "   "` (whitespace-only), and `path === undefined` (non-string). All three fall through to the substitution.
  - Non-empty admin submits (e.g. `"~/"` from the frontend default at NewSessionDialog.tsx L322 or an explicit override) pass through unchanged.
  - `path: parsedPath` invocation at L336 untouched — the orchestrator's `opts.path` contract is a string that accepts both `"~/"` and `"~/amelia/"`.

## Verification Results

### Grep source assertions (all pass)

| Assertion | Expected | Actual |
|-----------|----------|--------|
| `grep -c 'isAdmin = false' src/ui/sidebar/NewSessionDialog.tsx` | 1 | 1 |
| `grep -c 'isAdmin?: boolean' src/ui/sidebar/NewSessionDialog.tsx` | 1 | 1 |
| `grep -c 'Phase 88' src/ui/sidebar/NewSessionDialog.tsx` | ≥ 1 | 1 |
| `grep -c 'fail-closed' src/ui/sidebar/NewSessionDialog.tsx` | ≥ 1 | 2 |
| `grep -c 'PrettyConversationsPanel.tsx L285' src/ui/sidebar/NewSessionDialog.tsx` | ≥ 1 | 1 |
| `grep -c '{isAdmin && (' src/ui/sidebar/NewSessionDialog.tsx` | 0 | 0 |
| `grep -c 'isAdmin={isAdmin}' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 | 1 |
| `grep -c 'Phase 88' src/backend/database/routes/identity-birth.ts` | ≥ 1 | 1 |
| `grep -cE 'parsedPath =' src/backend/database/routes/identity-birth.ts` | 1 | 1 |
| `grep -cE 'name\.trim\(\)\.toLowerCase\(\)' src/backend/database/routes/identity-birth.ts` | ≥ 1 | 1 |
| `grep -c 'typeof path === "string" ? path : "~"' src/backend/database/routes/identity-birth.ts` | 0 | 0 |
| `grep -c 'path: parsedPath' src/backend/database/routes/identity-birth.ts` | 1 | 1 |

### Structural build

- `npx tsc --noEmit` completes with no errors mentioning any of the three modified files.

### Scoped tests

- `npx vitest run src/backend/database/routes/identity-birth.test.ts --run` → **23/23 passing** (Task 2's scoped test file).
- `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx src/ui/sidebar/NewSessionDialog.chain.test.tsx src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx src/ui/sidebar/NewSessionDialog.task-input.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx --run` → **172 passed / 11 pre-existing failures unchanged before-and-after the edits**. See "Pre-existing test failures" section below.

## Pre-existing Test Failures (Out of Scope)

The scoped vitest run on the NewSessionDialog + PrettyConversationsPanel test files reports 11 failures that were **identical before and after Plan 88-01's edits** (confirmed via `git stash` verify). All 11 come from Phase 86 test-file drift: tests reference "title" / "brief" labels that Phase 86 stripped from the modal but which the corresponding test files still exercise. These failures fall under Plan 88-03's surface per the plan's `<verification>` note:

> Plan 88-03 (Wave 3) adds explicit isAdmin-conditional tests.

Plan 88-03 will need to reconcile the pre-existing Phase 86 drift alongside its isAdmin-specific additions. Not blocking Wave 1 → Wave 2 progression.

## Threat Model Notes

All STRIDE items from the plan's `<threat_model>` are addressed by design:

- **T-88-01-01 (fail-closed default `isAdmin=false`):** Mitigated. `grep -c 'isAdmin = false'` = 1 (destructure line 285).
- **T-88-01-02 (backend authoritative substitution):** Mitigated for the empty/absent branch. Residual risk (non-admin client posts non-empty `body.path` directly, bypassing the UI admin-gate) accepted per plan §threat_model — outside the shape's scope.
- **T-88-01-03 (shell metachar injection via substituted name):** Accepted. `name.trim().toLowerCase()` is idempotent for the regex-validated kebab-case name.
- **T-88-01-04 (DoS via whitespace-only path):** Mitigated. The `.trim()` predicate ensures whitespace-only strings take the substitution branch.
- **T-88-01-SC (zero new deps):** Accepted. No `package.json` or `package-lock.json` touched.

No new threat flags surfaced during execution.

## Deviations from Plan

**One doc-level deviation, no functional impact:**

**[Rule 3 - Blocking issue] JSDoc content triggered acceptance-criteria grep false-positives**

- **Found during:** Task 1 verification (first grep pass returned 2 matches for `isAdmin = false` and 2 matches for `{isAdmin && (`, both should have been 1 and 0 respectively).
- **Root cause:** The initial JSDoc I wrote quoted the destructure literal `` `isAdmin = false` `` inline and used `` `{isAdmin && (…)}` `` to describe the Plan 88-02 gate pattern. Both quotes triggered extra grep hits.
- **Fix:** Reworded the JSDoc to describe the same concepts (fail-closed default, isAdmin-conditional JSX guards) without quoting the exact literal strings that the acceptance grep looks for. Semantic content preserved — no information loss.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.tsx` (JSDoc block only).
- **Commit:** folded into `9eb60747` (Task 1) before the commit — no separate commit needed.

**[Note] Acceptance-criteria `as string >= 4` awk check appears to reflect a planner miscount**

- **Found during:** Task 2 verification.
- **Details:** Plan L241 `<acceptance_criteria>` contains an assertion that `grep -c 'as string' src/backend/database/routes/identity-birth.ts` must return ≥ 4. Pre-plan count was 3 (parsedPath, parsedVoice, parsedTask). Post-plan count is 3 (parsedPath preserved). The plan's own action text at L212 says "Preserve the trailing `as string` cast so the type shape at the assignment site is unchanged" — which I did. Count doesn't decrease. The plan's `<verify><automated>` block (L259) does NOT include this awk check, so the authoritative executable acceptance gate passes.
- **Action:** Documented here for planner awareness. No adjustment required.

## Auth Gates

None. This plan required no authentication.

## Self-Check: PASSED

### Files exist verification

- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/sidebar/NewSessionDialog.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- [FOUND] `/home/ubuntu/skynet-tabitha/src/backend/database/routes/identity-birth.ts`

### Commits exist verification

- [FOUND] `9eb60747` — Task 1: plumb isAdmin?: boolean prop
- [FOUND] `873c73dd` — Task 2: extend parsedPath narrow

## Commits

| Task | Commit    | Files                                                                                                              |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| 1    | `9eb60747` | `src/ui/sidebar/NewSessionDialog.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`         |
| 2    | `873c73dd` | `src/backend/database/routes/identity-birth.ts`                                                                    |

## Wave 2 Unblock Contract

Plan 88-02 can now consume the `isAdmin` prop for:

1. **Path field admin-gate** at NewSessionDialog.tsx L926-942 — wrap the entire `<div>` in an `isAdmin`-conditional JSX guard. Non-admin submits will arrive with `body.path === ""` (Path input not rendered) and land in `~/<name>/` via the Task 2 backend narrow.
2. **Identity-mode checkbox admin-gate** at NewSessionDialog.tsx L944-960 — wrap the block in an `isAdmin`-conditional JSX guard. Non-admin never sees the "Just a shell" checkbox (fail-closed by prop default).
3. **Submit-onclick invariant** at NewSessionDialog.tsx L1131-1153 — non-admin submits force the agent-birth branch regardless of local `identityMode` state (defense-in-depth against a bug in the render gate).

Plan 88-03 can now:

- Write tests that pass `isAdmin={true}` and `isAdmin={false}` explicitly and assert the two conditional-render outcomes on NewSessionDialog.
- Write end-to-end assertions that a non-admin birth submit (`body.path === ""`) resolves to `~/<name>/` at the backend orchestrator invocation.
- Fold in the Phase 86 test-file drift cleanup (11 pre-existing failures) as part of the same wave.
