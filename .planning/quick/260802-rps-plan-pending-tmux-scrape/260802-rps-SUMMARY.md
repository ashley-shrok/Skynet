---
status: complete
quick_id: 260802-rps
description: Replace patch #63 JSONL scan for ExitPlanMode with tmux pane screen-scrape for the plan-approval Ink prompt
date: 2026-08-02
branch: feat/tab-title-from-tmux
commits:
  - 911dbfb feat(plan-pending-parser): add pane-scrape helper for Ink plan-approval prompt
  - 6263d10 refactor(claude-session-server): wire pane-scrape into plan-pending emission
---

# 260802-rps — plan-pending pane-scrape

## Outcome

PlanPendingBubble now renders live while the user is deciding on a proposed plan. Backend detection swapped from a JSONL scan (which no longer sees the signal — see root cause below) to a pane-scrape sitting on the SAME `tmux capture-pane -p` interval that already feeds `parseContextPct`. No extra SSH round-trip, no new WS message shape, no frontend change.

## Root cause (settled pre-execution)

Live diagnosis on Moxie/workstation 2026-08-02:

- Claude Code fleet is pinned to 2.1.150 and the pin is holding.
- 2.1.150's `ExitPlanModeV2Tool` code path BUFFERS the `ExitPlanMode` tool_use in Ink UI memory and only flushes the completed tool_use + tool_result pair to the parent JSONL when the user resolves the approval prompt.
- The model routes plan-mode tools through a deferred-tool load: `ToolSearch(query="select:ExitPlanMode")` → `ExitPlanMode(...)`. Anthropic-side model behavior, not a Claude Code binary change.
- Consequence: patch #63's parent-JSONL scan for unmatched ExitPlanMode tool_use has literally zero signal during the pending window. PlanPendingBubble effectively never shows.
- Direct proof: on Moxie's workstation JSONL, the ExitPlanMode tool_use appeared with its original 18:56:52 timestamp only after Ashley approved at 19:53:42 — a 57-minute gap during which the JSONL held nothing.
- V2 also added an `allowedPrompts` field to the tool input schema the V1 didn't have.

Neither the version pin nor the frozen model version protected against this — the change was in behavior neither is version-gated on.

## Implementation

Two atomic commits.

### Commit A — `911dbfb feat(plan-pending-parser)`

New pure helper `src/backend/claude-session/plan-pending-parser.ts` (84 lines, zero imports, zero I/O):

- `export function isPlanPending(paneText: string): boolean`
- Bottom-30-lines slice for the load-bearing `No, keep planning` reject-option marker (mirrors `context-pct-parser.ts`'s bottom-8 anchor rationale — Ink prompts always render in the pane footer, so bottom-anchoring keeps transcript quotes elsewhere from false-positiving).
- Header check anywhere in the pane for `Here is Claude's plan:` OR `Ready to code?` (the two header variants — 3-option with `--dangerously-skip-permissions`, 2-option default).
- Both conditions required. Fast path returns false for empty/whitespace input.

Companion vitest `plan-pending-parser.test.ts` (107 lines, 6 cases):

| Case | Expected | Notes |
|------|----------|-------|
| 3-option variant (bypass-permissions header) | true | positive |
| 2-option variant (Ready-to-code header) | true | positive |
| Header-only-no-prompt (transcript quote) | false | negative — header without bottom-slice marker |
| Options-in-prose-not-in-bottom-slice | false | negative — marker outside bottom slice |
| Empty / whitespace-only | false | negative — fast path |
| Random terminal output | false | negative — no plan-mode markers |

All 6 green in 380 ms.

### Commit B — `6263d10 refactor(claude-session-server)`

Wiring into `src/backend/claude-session/claude-session-server.ts` (+69/-5):

- Import `isPlanPending` from `./plan-pending-parser.js` (L12).
- `planPendingLastSerialized` sentinel declared alongside `contextPctLastSerialized` (L882).
- Called inside the SAME setInterval pane-scrape callback that already runs `parseContextPct` on `output`; no extra SSH round-trip (L3174–L3179).
- Emits the EXISTING WS message shape `{type:"plan_pending", pending: {planFilePath: ""} | null}`. `planFilePath` is `""` because the pane text doesn't carry it reliably and `PlanPendingBubble.tsx` doesn't consume it.
- Serialized-diff gate prevents WS spam on quiet ticks (matches the existing pattern for other periodic messages).
- `planPendingLastSerialized = "null"` reset mirrored at BOTH sentinel-reset sites: `teardownPane` (L960) and `transitionToActiveNew` (L1642).
- Deprecation comment block added above the legacy patch #63 JSONL scan (L1227) documenting the V2 buffered-write discovery and noting the scan is retained as belt-and-suspenders — harmless at the resolution edge (V2 flush re-emits pending:null; coalesces with the pane-scrape's own null-emit) and for backward-compat with any older Claude Code sessions still writing ExitPlanMode eagerly.

## Verification

All gates green:

| Gate | Result |
|------|--------|
| `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts` | **6/6 pass** (380 ms) |
| `npm run build:backend` | **green** — zero TS errors (load-bearing per patch #154 learned preference: `tsc --noEmit` alone is insufficient for backend files) |
| `npm run build` | **green** — vite production build 4.87 s |

Grep sanity:

- `import { isPlanPending }` at L12
- `planPendingLastSerialized` declaration L882
- Reset at L960 (teardownPane) + L1642 (transitionToActiveNew) — mirrors `contextPctLastSerialized` pattern
- Deprecation comment above legacy patch #63 scan at L1227
- Setinterval emission at L3174/L3178/L3179 on same `output` payload feeding `parseContextPct`

## Ship boundary

HELD per fleet ship rule (Ashley 2026-07-27):

- NOT pushed. NOT `docker build`. NOT `docker compose up`. Container still on the pre-execution image.
- Deploy queue now carries 5 code commits ahead of the container: `2318460 + 8c9ea5e` (patch #267), `042235e` (patch #268), `911dbfb + 6263d10` (this quick, presumably patch #269).
- Ashley greenlights ship separately.

## Out of scope

Tina orchestrator-side bookkeeping (numbered patch entry in `~/.claude/identities/tina/skynet-patches.md`, bounty timeline update, deploy runbook execution) handled outside this quick task.

## Post-ship UAT

Confirm PlanPendingBubble appears the next time an agent hits plan-approval on any managed host. Signal: fleet-wide any-agent-any-time; no need to reproduce Moxie's specific session.
