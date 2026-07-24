---
phase: 260723-2cg-add-a-subtle-inside-textarea-send-button
plan: 01
subsystem: pretty-view-composebox
tags: [ui, visual, ashley-locked, patch-129]
dependency-graph:
  requires:
    - src/ui/features/pretty-view/ComposeBox.tsx (existing handleSend at line 652)
    - src/ui/features/pretty-view/ComposeBox.test.tsx (existing describe blocks)
    - src/ui/components/textarea.tsx (shadcn base — unchanged)
    - lucide-react (SendHorizontal icon)
  provides:
    - patch #129: subtle inside-textarea Send button
    - fixes 3 stale-selector pre-existing test failures (patch #121 residual)
  affects:
    - PrettyView compose surface visual (adds one bare button + 40px right padding)
tech-stack:
  added: []
  patterns:
    - "Bare `<button type='button'>` instead of shadcn `<Button>` — sidesteps the `!` load-bearing wrapper-specificity trap that bit patches #81 and #117"
    - "Tailwind arbitrary-value inline styling for Ashley's console-locked color/position values"
    - "Delegated routing — button onClick just calls existing handleSend(); no branching duplication"
key-files:
  created:
    - .planning/quick/260723-2cg-add-a-subtle-inside-textarea-send-button/260723-2cg-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx (+50/-2, ~52 net add)
    - src/ui/features/pretty-view/ComposeBox.test.tsx (+81/-4, ~77 net add)
decisions:
  - "Bare button over shadcn Button — planner's guidance held up (would have needed `!` on every color class otherwise)"
  - "STRICT canSend === false (not `!canSend`) in sendDisabled predicate — Rule 1 fix during TDD-red; matches every other button in the file"
  - "Added localStorage.clear() to beforeEach — Rule 2 test-hygiene fix; the patch #119 ls-mirror was bleeding between tests"
metrics:
  duration: ~7 minutes
  completed: 2026-07-23T01:51:48Z
  commit: 37986b2
---

# Quick Task 260723-2cg: Add Subtle Inside-Textarea Send Button (patch #129) Summary

One-liner: Ashley's console-locked subtle inside-textarea Send button (bare `<button>` inside the compose textarea wrapper, absolute right-3 bottom-2.5, quiet 30%→90%→15% currentColor states) shipped as one atomic commit routing entirely through the existing handleSend() — no branching duplication.

## What Shipped

**Files changed (2, one atomic commit `37986b2`):**

| File | Δ | Purpose |
|---|---|---|
| `src/ui/features/pretty-view/ComposeBox.tsx` | +50/-2 | SendHorizontal import; sendDisabled derived predicate; pr-10 on Textarea; new `<button type="button">` inside the `relative flex-1 self-stretch` wrapper as sibling to Textarea and queueArmed overlay |
| `src/ui/features/pretty-view/ComposeBox.test.tsx` | +81/-4 | 3 new tests (renders bare button inside wrapper; click sends trimmed payload + clears; disabled state Cases A & B); 3 stale-selector fixes (Test 7, Test 8, Phase 9 aux-row: `/send message/i` → `{ name: 'Send' }`); localStorage.clear() in both beforeEach blocks |

**Ashley-locked visual (implemented verbatim, no "improvements"):**
- Position: `absolute right-3 bottom-2.5` (12px right, 10px bottom inset)
- Icon: SendHorizontal, `size-6` (24×24), `fill="currentColor"` — paper-plane silhouette
- Hit target: `p-2` = 40×40 (24 + 8+8) around the icon
- Rest: `text-[rgba(240,235,224,0.3)]`
- Hover: `hover:text-[rgba(240,235,224,0.9)]`
- Disabled: `disabled:text-[rgba(240,235,224,0.15)]` + `disabled:cursor-not-allowed`
- Motion: `transition-[color,transform] duration-120` + `active:scale-95`
- Cursor: `cursor-pointer` (enabled)

**Routing (no branching duplication per plan):**
- `onClick={() => { if (!sendDisabled) handleSend(); }}` — routes ALL send behavior through the existing handleSend() at line ~652
- Attachment path, D-50 newline collapse, COMPOSE-04 clear-on-success — unchanged inheritance from Enter-to-send
- `disabled={sendDisabled}` — native disabled attr; click is no-op when disabled AND assistive tech announces state

**Padding:** `pr-10` added to Textarea className AFTER `px-4` so tailwind-merge later-wins keeps left padding at 16px while right padding becomes 40px — typed text no longer slides under the icon.

## Verification (all three gates passed)

1. **`npx tsc --noEmit`** — clean (exit 0, no output).
2. **`npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx`** — 16/18 passing.
   - Newly-added Send-button tests: 3/3 green.
   - Fixed pre-existing stale-selector tests: Test 7 ✓, Test 8 ✓, Phase 9 aux-row ✓ (all now resolve to the new inside-textarea button via `getByRole('button', { name: 'Send' })`).
   - Remaining 2 failures: BOTH stem from the patch #124 ThumbsUp `/send 'yes'/i` residual (aria-label was renamed to "Send 'let's go'" but 2 tests still search for the old label). Out of scope per plan and STATE.md. Documented under **Deferred Issues** below.
3. **`npm run build`** — succeeds in 8.87s. AppShell bundle now 448.83 kB (gzip 87.62 kB). Chunk-size warning is pre-existing (unrelated to this patch).

## Deviations from Plan

### Rule 1 - Bug: `sendDisabled` predicate `!canSend` → `canSend === false`

- **Found during:** TDD-red on the new Test N+2 and Test 7 case B — both tests found `onSend` was called 0 times after clicking Send with valid text.
- **Root cause:** The plan-spec predicate `queueArmed || (!canSend && !hasAttachments) || (text.trim() === "" && !hasAttachments)` over-disables when `canSend` is `undefined` (default): `!undefined === true`, so the second clause evaluates true whenever no attachments are present, disabling the button regardless of text state. Every other button in the file uses `disabled={canSend === false}` (strict false-check) — the plan's `!canSend` was a bug.
- **Fix:** Changed `!canSend && !hasAttachments` → `canSend === false && !hasAttachments`. Comment expanded to explain the strict-check rationale so future edits don't regress.
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.tsx` (sendDisabled derivation).
- **Commit:** `37986b2` (included in the atomic patch).

### Rule 2 - Missing test hygiene: `localStorage.clear()` in `beforeEach`

- **Found during:** Same TDD-red investigation. The `stderr` log showed `[compose-draft] load ... lsLen=10` on tests that render fresh ComposeBox instances — the patch #119 compose-draft-ls mirror was persisting between tests within the shared JSDOM instance. Without a clear, tests that mount after an earlier test typed anything would hydrate from stale LS and the hydrate effect's `setText(hydratedBody)` would fire asynchronously, silently over-writing the fresh test's `text=""` initial state and flipping `sendDisabled` unexpectedly.
- **Fix:** Added `localStorage.clear()` alongside `vi.clearAllMocks()` in both existing `beforeEach` blocks (Phase 05 upload wiring describe + Phase 9 layout describe).
- **Rationale:** This is a test-infrastructure correctness issue — the tests weren't truly isolated, just happened to pass because the LS pollution never caused a false-positive before. Fixing it now prevents future flakes when new tests are added.
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.test.tsx` (both `beforeEach` blocks).
- **Commit:** `37986b2`.

### None else — no other deviations.

## Deferred Issues

**2 pre-existing test failures remain (out of scope per plan):**

Both use `getByLabelText(/send 'yes'/i)` which was the ThumbsUp button's aria-label BEFORE patch #124 renamed it to "Send 'let's go'". STATE.md flagged this as the 4th pre-existing failure; in practice TWO tests hit that selector:

| Test | File:line | Selector |
|---|---|---|
| `Phase 9 Layout: aux button group renders in a row that precedes the Send button's row` | ComposeBox.test.tsx:~393 | `getByLabelText(/send 'yes'/i)` (line 383) |
| `Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false` | ComposeBox.test.tsx:~452 | `getByLabelText(/send 'yes'/i)` (line 442) |

**Fix (deferred):** Change both to `getByLabelText(/send 'let's go'/i)`. Trivial one-line-each patch. Recommended for the next test-hygiene sweep or a dedicated small quick task — NOT bundled into #129 per plan's scope discipline (planner explicitly said "leave the ThumbsUp `let's go` residual alone; do not chase").

**STATE.md drift note:** STATE.md line 152 says "4 pre-existing ComposeBox failures — 3 patch #121 Send-button residual + 1 patch #124 ThumbsUp residual." The 1 → 2 delta above is because two Phase 9 tests use the same stale selector. Update STATE.md's next revision to reflect the correction.

## Deploy Discipline

**NOT deployed. NOT pushed.** Branch: `feat/tab-title-from-tmux`, commit `37986b2`.

Stacks on top of #123-#128 (six commits since last push at `491d828`, now seven with this patch — 22+ commits ahead of last remote).

Awaiting Ashley's morning UAT walkthrough of the batched #123-#128 stack; deploy sequence documented in `.planning/phases/10-pretty-conversations-visual-language-rework/10-UAT-CHECKLIST.md`. This patch (#129) will land in that same UAT + deploy stack — do NOT `docker build`, `docker compose up`, or `git push` without explicit Ashley greenlight per fork discipline.

## Draft Patch #129 Entry for Tina's `skynet-patches.md`

*(Paste-ready in the established Tina multi-commit-under-one-pin format, single-commit variant:)*

```markdown
- **Patch #129 (Bounty: send-button-inside-composebox-textarea)** — Ashley's console-locked "subtle inside-textarea send button" baked into pretty-view ComposeBox. Bare `<button type="button">` (NOT shadcn Button — sidesteps the wrapper-specificity trap that needed `!` on every color class in patches #81/#117) positioned `absolute right-3 bottom-2.5` INSIDE the existing `relative flex-1 self-stretch` textarea wrapper, sibling to `<Textarea>` and the queueArmed overlay. lucide `SendHorizontal` at 24×24 with `fill="currentColor"` renders as a solid paper-plane silhouette. 40×40 hit target via `p-2`. Rest color `rgba(240,235,224,0.3)` (ChatGPT/iMessage-quiet — deliberately NOT the retired amber-Send from patch #121); hover `0.9`, disabled `0.15`. `transition-[color,transform] duration-120` + `active:scale-95` for tactile press. Textarea gets `pr-10` (40px right padding) so typed text does not slide under the icon; placed after `px-4` in the className so tailwind-merge later-wins keeps left padding at 16px. New `sendDisabled` derived predicate: `queueArmed || (canSend === false && !hasAttachments) || (text.trim() === "" && !hasAttachments)` — strict `canSend === false` (not `!canSend`) matches every other button in the file so an undefined default at read-only PrettyView call sites doesn't over-disable. `onClick` routes ENTIRELY through the existing `handleSend()` at line 652 — attachment branching, D-50 newline collapse, COMPOSE-04 clear-on-success, error handling all inherited with zero duplication. Test file gains 3 new coverage tests (renders as bare button inside wrapper; click-with-text calls onSend with trimmed payload + clears textarea; disabled state Cases A empty-text and B canSend=false), plus 3 stale-selector fixes (Test 7, Test 8, Phase 9 aux-row — `getByLabelText(/send message/i)` → `getByRole('button', { name: 'Send' })` — the retired amber-Send from patch #121 wore aria-label="Send message"; new inside-textarea Send wears aria-label="Send" exact-equal); plus `localStorage.clear()` added to both `beforeEach` blocks as a test-hygiene fix because the patch #119 compose-draft-ls mirror was silently bleeding between tests within the shared JSDOM instance. tsc clean, +147/-6 across 2 files, vitest 16/18 (2 remaining failures are the patch #124 ThumbsUp `/send 'yes'/i` aria-label residual — deferred to next test-hygiene sweep). `npm run build` succeeds in 8.87s. Deploy deferred: batched with #123-#128 pending Ashley UAT greenlight. Commit: `37986b2`.
```

**Pin bump:** ONE HUNDRED TWENTY-EIGHT → ONE HUNDRED TWENTY-NINE (do NOT bump until AFTER deploy per Tina's established discipline).

## Self-Check: PASSED

**Files verified exist:**
- `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND (modified)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — FOUND (modified)
- `.planning/quick/260723-2cg-add-a-subtle-inside-textarea-send-button/260723-2cg-SUMMARY.md` — FOUND (this file)

**Commit verified:**
- `37986b2` — FOUND on `feat/tab-title-from-tmux`

**Predicate verified via grep:**
- `SendHorizontal` in ComposeBox.tsx — FOUND
- `pr-10` in ComposeBox.tsx — FOUND
- `sendDisabled` in ComposeBox.tsx — FOUND
- `aria-label="Send"` (exact) in ComposeBox.tsx — FOUND
- `if (!sendDisabled) handleSend()` routing pattern in ComposeBox.tsx — FOUND
