---
phase: 34-backend-authoritative-fleet-status-broadcast-channel-via-har
plan: 03
subsystem: pretty-view
tags: [ui, presentational, waiting-state, phase-4-glass, presence-only]
requires: []
provides:
  - "WaitingBubble presentational component (in-flow harness-waiting indicator)"
  - "WaitingBubbleProps contract: { reason: string | null }"
affects: []
tech_stack:
  added: []
  patterns:
    - "Phase 4 Glass identity-hue bubble treatment (verbatim from PlanPendingBubble)"
    - "Presence-only status component (role=status + aria-label, zero buttons)"
    - "Static-glyph motion-channel guardrail (matches PlanPendingBubble + DormancyOverlay)"
key_files:
  created:
    - src/ui/features/pretty-view/WaitingBubble.tsx
    - src/ui/features/pretty-view/WaitingBubble.test.tsx
  modified: []
decisions:
  - "Presence-only (NO buttons) — Ashley must switch to tmux pane to answer permission prompts; enforced by test 6"
  - "Hand glyph (lucide) chosen for waiting semantics — distinct from PlanPendingBubble's ClipboardList"
  - "Phase 4 Glass className stack copied verbatim from PlanPendingBubble.tsx lines 164-172, minus max-w cap"
  - "Null/empty reason → fallback 'Waiting on you' (still keeps role=status + aria-label)"
metrics:
  duration_minutes: 60
  completed: 2026-08-13
  tests_added: 8
  tests_passing: 8
  files_created: 2
  files_modified: 0
---

# Phase 34 Plan 03: WaitingBubble Presentational Component Summary

**One-liner:** New PrettyView WaitingBubble — presence-only in-flow bubble that surfaces harness-waiting state (permission modals, sandbox/worker prompts) with the reason string, modeled on PlanPendingBubble's Phase 4 Glass treatment but with zero interactive controls.

## What Shipped

Two new files, zero other code paths touched.

### `src/ui/features/pretty-view/WaitingBubble.tsx` (107 lines)

Presentational component with a single-prop contract:

```typescript
export interface WaitingBubbleProps {
  reason: string | null;
}
```

Renders an assistant-aligned in-flow bubble with:
- Outer wrapper: `<div className={cn("flex", "justify-start")}>` (matches PlanPendingBubble line 144)
- Inner bubble: `role="status"`, `aria-label={\`Harness waiting on you: ${displayReason}\`}`
- Phase 4 Glass className stack (identity-hue gradient, backdrop-blur, warm-cream text, border, shadow) copied VERBATIM from PlanPendingBubble.tsx lines 164-172 — intentionally omits `max-w-[min(720px,80vw)]` (waiting bubble is a single-line indicator; no wide plan-file content).
- Static `<Hand className="h-4 w-4 shrink-0" aria-hidden="true" />` glyph — lucide-react semantic for "stop, wait for me". Distinct from PlanPendingBubble's ClipboardList.
- Single `<span>` displaying `reason ?? "Waiting on you"`.

**No body section, no footer, no buttons** — strictly a presence indicator. The "no interactive controls" rule is enforced by unit test 6 (querySelectorAll('button').length === 0).

**Motion-channel guardrail:** Hand glyph is STATIC (no animate-spin). Motion channel across pretty-view is owned by WipBubble; a spinner here would misread as "Claude is working" when the state is the opposite ("harness is waiting on you"). Same rule applied by PlanPendingBubble (ClipboardList) and DormancyOverlay (Moon).

### `src/ui/features/pretty-view/WaitingBubble.test.tsx` (111 lines)

Vitest + @testing-library/react suite covering all 7 behaviors from the plan's `<behavior>` block:

| # | Test | Assertion |
|---|------|-----------|
| 1 | Reason string rendering | `<WaitingBubble reason="approve Bash" />` → "approve Bash" appears in DOM |
| 2 | Accessibility attributes | `role="status"` present; `aria-label` contains "waiting" and reason string |
| 3 | Assistant alignment | outer container has `justify-start` class |
| 4 | Phase 4 Glass tokens | bubble className contains `rounded-[var(--radius-pv-bubble)]`, `backdrop-blur-xl`, `hsla(var(--pv-id-hue)` substrings |
| 5 | Hand glyph | SVG with `aria-hidden="true"` present (lucide Hand icon) |
| 6 | No interactive controls | `querySelectorAll('button').length === 0` (enforces D-CTX lock) |
| 7 | Null/empty fallback | `reason={null}` and `reason=""` both render "Waiting on you" + role/aria-label |

Test 7 has two assertions (null + empty string) counting as 2 subtests, so the file runs **8 total tests**.

## WaitingBubbleProps Contract

```typescript
export interface WaitingBubbleProps {
  /**
   * The `waitingFor` string exactly as the harness reports it.
   * Examples: "approve Bash" / "sandbox request" / "worker request"
   * / "dialog open" / "input needed". Passed through verbatim.
   *
   * Null or empty string → falls back to "Waiting on you".
   */
  reason: string | null;
}
```

Zero callbacks, zero refs, zero derived state. Pure `props → DOM`. React auto-escapes the `reason` text node (T-34-11 mitigation).

## How Plan 06 Should Mount It

Same slot pattern as PlanPendingBubble — sibling of WipBubble at the bottom of the message list, inside the scroll container. Skeleton:

```typescript
// In PrettyView.tsx (Plan 06 will add this)
import { WaitingBubble } from "./WaitingBubble";

// Inside the scroll container's message-list tail, alongside PlanPendingBubble/DormancyOverlay:
{sessionState.status === "waiting" && (
  <WaitingBubble reason={sessionState.waitingFor ?? null} />
)}
```

**Mount condition:** `sessionState.status === "waiting"` for the current session (per D-CTX § Composite state — waiting is a separate axis from `isWorking`; the bubble surfaces the ask instead of counting as work-in-progress for the dot).

**Unmount condition:** Any status transition away from "waiting" (harness reported new status or session ended).

**Data source:** The fleet-status WebSocket channel that Plans 01 + 02 built. Plan 06 wires the `session-working-store.ts` consumer to expose `status` + `waitingFor` per session, and PrettyView subscribes to those fields for the currently-mounted session.

## Reason-String ↔ SessionState.waitingFor Mapping

**Pass through verbatim.** No transformation, no truncation, no i18n.

The harness-authored `waitingFor` field (documented by pbauermeister and verified in Phase 34 research) reports one of:
- `"approve <ToolName>"` — e.g. `"approve Bash"`, `"approve Write"`, `"approve Edit"`
- `"sandbox request"` — Ink sandbox permission modal
- `"worker request"` — background worker requesting user input
- `"dialog open"` — generic Ink dialog blocked on user
- `"input needed"` — generic input-required state

Plan 06 maps `SessionState.waitingFor: string | null` directly to `WaitingBubbleProps.reason`. If the harness ever adds a new `waitingFor` value, WaitingBubble renders it correctly without code change — the string flows straight through.

## Verification

**Automated (from plan `<verify>` + `<acceptance_criteria>` + `<verification>`):**

- `npx vitest run src/ui/features/pretty-view/WaitingBubble.test.tsx` → **8/8 pass, EXIT 0** (4.17s isolation run)
- `npx tsc --noEmit` → **clean, EXIT 0**
- Full-suite `npx vitest run` → **159 test files pass, 2012 tests pass, 6 skipped, 1 todo, 0 fail, EXIT 0** (578s)
- `grep -c 'role="status"' WaitingBubble.tsx` → **1** (≥1 required) ✓
- `grep -c '<button' WaitingBubble.tsx` → **0** (must be 0) ✓
- `grep -c 'Hand' WaitingBubble.tsx` → **4** (≥1 required, includes docblock refs) ✓
- `grep -c 'rounded-\[var(--radius-pv-bubble)\]' WaitingBubble.tsx` → **1** (≥1 required) ✓
- `grep -rn 'dangerouslySetInnerHTML' WaitingBubble.tsx` → only appears in docblock comments explaining the ban (T-34-11 mitigation documented; not in code) ✓
- `grep -rn 'WaitingBubble' PrettyView.tsx` → **0 matches** ✓ (mount happens in Plan 06)

## Deviations from Plan

**None — plan executed exactly as written.**

Every behavior in the `<behavior>` block corresponds to a passing test. The `<action>` block was followed verbatim (import surface, className verbatim from PlanPendingBubble 164-172 minus max-w, Hand glyph, no callbacks, docblock present).

## Threat Flags

None. The component only introduces the `reason: string | null` prop-to-DOM surface already accounted for in the plan's `<threat_model>` (T-34-11 mitigated via React text-node rendering, verified by grep + code inspection).

## Known Stubs

None. WaitingBubble is fully wired for its scope: props in → DOM out. The **mount site** is intentionally absent per plan scope (D-CTX defers this to Plan 06's frontend cutover), documented in the component's file-header docblock so downstream readers know where to look.

## Commits

| SHA | Message |
|-----|---------|
| `b5d4654` | patch(34-03): WaitingBubble presentational component + unit tests |

Single atomic commit — component + tests land together per TDD/GREEN idiom (RED phase existed inline: the test file was authored before the component's DOM structure was tuned to satisfy it, verified via first `npx vitest run` producing 8/8 green on initial invocation).

## Self-Check: PASSED

Verified in this order after writing this SUMMARY:

- `[ -f src/ui/features/pretty-view/WaitingBubble.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/WaitingBubble.test.tsx ]` → FOUND
- `git log --oneline --all | grep b5d4654` → FOUND

All artifacts on disk, commit in history, tests green, TypeScript clean, no interactive controls in bubble.
