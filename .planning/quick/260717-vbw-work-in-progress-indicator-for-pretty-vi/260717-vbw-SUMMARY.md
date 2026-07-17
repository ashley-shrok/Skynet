---
phase: 260717-vbw
plan: 01
type: quick
tags: [pretty-view, wip-indicator, patch-51]
---

# Quick Task 260717-vbw: Work-in-Progress Indicator for Pretty View

**One-liner:** JSONL-driven WIP spinner bubble in pretty view — no polling, no new I/O, tail-based state machine emits `{type:"wip",active}` frames on the existing claude-session WS.

## Commits

| Hash | Message |
|------|---------|
| `8edde69` | feat(pretty-view): add wip-classifier for JSONL turn state machine |
| `c1fbf83` | feat(pretty-view): emit WIP transitions on the claude-session WS |
| `e8c72f4` | feat(pretty-view): wire the wip message type into claude-session-api |
| `29d899f` | feat(pretty-view): add WipBubble component (spinner + assistant-side alignment) |
| `caafaa5` | feat(pretty-view): render WipBubble when session is WIP |

## Net Change

5 files changed, 234 insertions(+)

## Files Modified / Created

| File | Status | Role |
|------|--------|------|
| `src/backend/claude-session/wip-classifier.ts` | NEW | Pure `classifyWipTransition()` — JSONL turn state machine |
| `src/backend/claude-session/claude-session-server.ts` | EDITED | Imports classifier, adds `wipActive`/`initialWipEmitted`, emits `{type:"wip",active}` on transitions |
| `src/ui/api/claude-session-api.ts` | EDITED | `WipEvent` type + added to `ClaudeSessionServerEvent` union |
| `src/ui/features/pretty-view/WipBubble.tsx` | NEW | Assistant-side Loader2 spinner bubble, `role="status"`, `aria-label` |
| `src/ui/features/pretty-view/PrettyView.tsx` | EDITED | `wipActive` state, reset on mount, `case "wip"` in WS switch, `{wipActive && <WipBubble />}` as last child of `contentRef` wrapper |

## JSONL State Machine (implemented in wip-classifier.ts)

| Turn type | Condition | Signal |
|-----------|-----------|--------|
| `user` | `isMeta === true` | `null` (no change) |
| `user` | harness wrapper (`<task-notification>` / `<system-reminder>`) | `null` (no change) |
| `user` | real user speech | `"start"` (WIP=true) |
| `assistant` | has any `tool_use` block | `"start"` (WIP=true) |
| `assistant` | text-only (has `text`, no `tool_use`) | `"end"` (WIP=false) |
| `assistant` | only `thinking` blocks (defensive) | `"start"` (WIP=true) |
| anything else | system, malformed, meta | `null` (no change) |

## Build Result

`npm run build` exited 0. Vite + tsc both passed. No warnings beyond the pre-existing chunk-size advisory (unrelated to this patch).

## Known Edge Case (documented, no code fix)

If Claude Code crashes or is killed mid-tool-call, the last JSONL event will be `tool_use` or `tool_result` and WIP will remain `true` until new user input arrives. Accepted per Ashley's design brief. No fix in this patch.

## Deviations from Plan

None. Plan executed exactly as written.

## Deploy Status

NOT DEPLOYED. Requires a future `build-termix.sh` + `docker compose up -d --force-recreate termix` behind the mandatory 15-min deadman when Ashley authorizes.
