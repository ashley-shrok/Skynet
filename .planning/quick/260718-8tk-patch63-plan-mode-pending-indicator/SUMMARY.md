---
id: 260718-8tk
status: complete
date: 2026-07-18
description: plan-mode pending indicator in pretty view (patch #63)
commit: fb65084
---

# Patch #63: Plan-Mode Pending Indicator in Pretty View

## Overview

Adds a compact "plan pending" indicator bubble to pretty view that
appears whenever the tailed Claude Code session has an unmatched
`ExitPlanMode` tool_use — i.e. Claude has proposed a plan and is
waiting on Ashley's `1` (accept) / `2` (keep planning) reply in Plan
Mode. Mounts as the last child of the message-content wrapper
(sibling to `WipBubble`), not as a sidebar panel — it belongs in the
conversation flow because it represents a moment where Claude is
asking for input.

**Detection mechanism** (Ashley-verified against a live JSONL,
2026-07-18): every ExitPlanMode confirmation prompt appears as an
assistant turn with `stop_reason:"tool_use"` and a `tool_use` content
block where `name === "ExitPlanMode"`. The block carries an `id`
(the tool_use_id) and inputs `plan` (markdown body) + `planFilePath`.
It stays unmatched until Ashley replies — at which point a subsequent
user turn's `content[]` includes a `{type:"tool_result",
tool_use_id:"toolu_..."}` block closing the pair. **Same shape patch
#61 uses to correlate backgrounded Agent invocations** — so this
patch piggybacks directly on that scan block, reusing the same
`JSON.parse(line)` and destructured `obj`/`content` variables. No
new SSH poller, no timer, no touch on `session-file-parser.ts`.

Ships as one atomic feature commit
(`feat(pretty-view): plan-mode pending indicator (patch #63)`, SHA
`fb65084`), followed by this docs commit for PLAN.md / SUMMARY.md /
STATE.md handled by the `/gsd:quick` finalize step.

## Backend Changes

### `src/backend/claude-session/claude-session-server.ts`

**WS protocol comment** (~line 22-30) — added one line documenting
the new event type between `backgrounded_agents` and `inactive`:

```
 *     { type: "plan_pending", pending }                          // unmatched ExitPlanMode tool_use in the parent JSONL — non-null when Claude is waiting on the user's "1"/"2" Plan Mode reply (patch #63)
```

**Per-connection closure state** — two new locals alongside the
existing `backgroundedAgents*` locals (patch #61):

```ts
const pendingPlans = new Map<
  string,
  { planFilePath: string; ts: number }
>();
let pendingPlansLastSerialized = "null";
```

**Load-bearing init to `"null"` not `""`.** The emit shape when
pending is null is `{ type: "plan_pending", pending: null }` and
`JSON.stringify(null) === "null"`, so matching the initial sentinel
to `"null"` suppresses the spurious first empty emit that would
otherwise fire after `tail -F -n +1` replay converges. Same
"initial-sentinel matches the empty stringification" trick patch
#61 uses (with `"[]"` for its array-shaped emit).

**Teardown** — `teardownPane` now clears both `pendingPlans` and
resets `pendingPlansLastSerialized` back to `"null"` alongside the
existing `harnessTasksLastSerialized = null` line.

**Parallel raw-line scan** in the existing `tailSessionFile` onLine
callback, inside the SAME try wrapper patch #61 opened. Reuses
patch #61's `obj` and `content` destructured variables — do NOT
re-parse. RENDER-01 HARD LOCK preserved: this runs alongside
`parseSessionLine`, not through it (tool_use/tool_result blocks
are stripped structurally at the parser).

The scan:
- On `type:"assistant"` with array `message.content` — for each
  block matching `{type:"tool_use", name:"ExitPlanMode", id}`,
  `pendingPlans.set(block.id, {planFilePath, ts})` with `ts` from
  the entry's `timestamp` (falls back to `Date.now()`).
- On `type:"user"` with array `message.content` — for each
  `{type:"tool_result", tool_use_id}`,
  `pendingPlans.delete(tool_use_id)`.
- After: take the first entry via `.values().next()` — only one
  ExitPlanMode can be pending at a time in practice (Claude Code's
  Ink UI serializes Plan Mode prompts). If somehow more than one
  survives, we still emit a stable answer until one is closed.
- `JSON.stringify` current pending, compare to
  `pendingPlansLastSerialized`, emit on change.

## Wire Changes

### `src/ui/api/claude-session-api.ts`

New event type between `BackgroundedAgentsEvent` and `TailErrorEvent`:

```ts
export type PlanPendingEvent = {
  type: "plan_pending";
  pending: { planFilePath: string } | null;
};
```

Inline `pending` shape — no separate `PlanPending` interface. Matches
patch #52's compact posture for `ContextPctEvent`.

Union `ClaudeSessionServerEvent` extended with `| PlanPendingEvent`
between `BackgroundedAgentsEvent` and `TailErrorEvent`.

## Frontend Changes

### `src/ui/features/pretty-view/PlanPendingBubble.tsx` (NEW)

Mirrors `WipBubble.tsx` structure — same outer flex-justify-start
container, same inner bubble classes matching `ChatMessage`'s
assistant treatment — but with:

- **Static `ClipboardList` glyph**, NOT a spinner. Motion channel is
  owned by `WipBubble` ("Claude is working"); plan-pending is the
  OPPOSITE state ("Claude is waiting on you") so a spinner would be
  semantically wrong. Mirrors patch #53's static-glyph rationale
  for HarnessTasksPanel in-progress rows.
- **One line of copy** with the reply contract: `Plan proposed —
  reply <code>1</code> to accept, <code>2</code> to keep planning`.
  The `<code>` tags render the `1` and `2` with the fork's monospace
  visual (patch #48's `prose-code:font-[JetBrains_Mono_Variable]`
  opt-back applies globally within pretty-view render tree, so the
  tokens do not need explicit className).
- **`role="status"` + `aria-label="Plan waiting for your approval"`**
  on the inner bubble for assistive technology.
- No props — pure indicator component.

### `src/ui/features/pretty-view/PrettyView.tsx`

Five additive edits:

1. `import { PlanPendingBubble } from "./PlanPendingBubble";` next
   to the `WipBubble` import so the "in-stream indicator bubbles"
   group visually.
2. New `planPending` state hook (`{planFilePath: string} | null`,
   initial `null`) after the `backgroundedAgents` state hook.
3. `setPlanPending(null)` reset in the mount effect next to
   `setBackgroundedAgents([])`.
4. New WS case `case "plan_pending": setPlanPending(parsed.pending);
   break;` after the `backgrounded_agents` case.
5. Mount `{planPending && <PlanPendingBubble />}` immediately after
   `{wipActive && <WipBubble />}`, still inside the `contentRef`
   wrapper. Both bubbles can co-mount briefly (~1s window after
   Claude emits ExitPlanMode tool_use but before the PTY-idle
   detector notices) — not gated against each other.

## Verification

- `npx tsc --noEmit` exits 0 (clean).
- `npm run build` exits 0 (clean; vite build 8.05s).
- Compiled invariants (against freshly-built `dist/backend/`):
  - `grep -c 'type: "plan_pending"' dist/backend/backend/claude-session/claude-session-server.js` → 3 (plan required ≥1)
  - `grep -c 'planPending\|pendingPlans' dist/backend/backend/claude-session/claude-session-server.js` → 11 (plan required ≥3)
- `git diff-tree --name-only -r HEAD` (code commit `fb65084`)
  matches exactly the 4 target files.

## Files touched (4)

1. `src/backend/claude-session/claude-session-server.ts` — WS
   protocol comment addition + 2 closure state locals + teardownPane
   clears + parallel raw-line scan block extending the patch-#61
   try wrapper (~87 lines added).
2. `src/ui/api/claude-session-api.ts` — new event type + union
   variant (6 lines added).
3. `src/ui/features/pretty-view/PrettyView.tsx` — 5 additive edits
   (import + state hook + reset + WS case + mount, 17 lines added).
4. `src/ui/features/pretty-view/PlanPendingBubble.tsx` (NEW) — ~45
   lines, mirrors `WipBubble.tsx` structure with static
   `ClipboardList` glyph and one-line copy.

## Scope explicitly out (deferred for later patches)

- **Plan body rendering.** Ashley's explicit ask was
  "compact WipBubble-style indicator only" — no preview, no click-to-
  expand, no on-disk read of `planFilePath`. If a future patch wants
  the plan body inline, `planFilePath` is already tracked in backend
  state (kept alongside `ts` for exactly this reason).
- **Auto-accept/decline buttons.** Plan Mode replies belong to
  Ashley + Claude Code; pretty view is the observer surface.
- **60s tool_use-mtime staleness fallback** for orphaned
  ExitPlanMode from crashed Claude Code sessions. Same class of
  accepted risk as patch #61's backgrounded-agents map. Apply once,
  apply everywhere in the same file if it ever bites.
- **Multi-pending display.** Only one ExitPlanMode can be pending
  at a time in practice (Ink UI serializes prompts); we take
  `.values().next()` and stop. If Claude Code ever emits
  concurrent Plan Mode prompts, the panel would need to grow to a
  list — currently out of scope.

## Rebase risk

**MEDIUM on `claude-session-server.ts`** — the scan block sits
INSIDE the patch-#61 try wrapper, which itself sits alongside
patch #51's idle emit and patch #52's context+harness pollers,
all in the busiest fork-hot spot in this file. Preserve the scan
block BEFORE the `const agents = Array.from(...)` line so the
plan-pending emit fires alongside the backgrounded-agents emit
on the same tick.

**MEDIUM on `PrettyView.tsx`** — patches #43/#44/#45/#50/#51/#52/#61
all touch this file. Every #63 addition is additive at natural
extension points (import next to WipBubble, state hook alongside
backgroundedAgents, WS case after backgrounded_agents, mount as
sibling to WipBubble). Conflicts should resolve cleanly.

**LOW on `claude-session-api.ts`** — additive type + union
extension in a fork-only file.

**LOW on `PlanPendingBubble.tsx`** — new fork-only file, no
upstream analog.

## Cross-references

- **Detection shape** — same tool_use/tool_result correlation
  pattern patch #61 uses for backgrounded Agent invocations. This
  patch piggybacks on patch #61's existing scan, reusing its
  `JSON.parse` and destructured `obj`/`content` variables.
- **Bubble aesthetics** — mirrors `WipBubble.tsx` (patch #51) with
  a static-glyph swap per patch #53's motion-channel rationale.
- **Copy conventions** — `<code>` tags on `1` and `2` inherit
  patch #48's `prose-code:font-[JetBrains_Mono_Variable]` opt-back
  within pretty-view's render tree.

## Deploy status

**Deploy pending Ashley's explicit go-ahead.** Per fork DEPLOY
DISCIPLINE (tina.md), the build step landed via `npm run build`
locally but the `sudo docker compose up -d --force-recreate skynet`
step is a separate risk gate that needs its own "go" — this patch
joins the pending-batch alongside patches #60/#61/#62. The batch
deploy happens later with the mandatory deadman + green-light
protocol. AGENTS.md write-up (bump SIXTY-TWO→SIXTY-THREE header,
add per-patch entry, update drift caveat for the four touched
files) happens IN-TURN at pin, not now.

## Patch story pointer

This will become **patch #63** in the fork's AGENTS.md numbered-patch
catalog. Per fork discipline the AGENTS.md write-up happens at PIN
(post-deploy, after Ashley confirms the deploy holds), not at commit.
