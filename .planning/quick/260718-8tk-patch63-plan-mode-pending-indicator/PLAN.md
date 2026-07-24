---
task: 260718-8tk-patch63-plan-mode-pending-indicator
type: quick
autonomous: true
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/PlanPendingBubble.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
---

<objective>
Patch #63: add a compact "plan pending" indicator bubble to pretty view that
shows when the tailed Claude Code session has an unmatched `ExitPlanMode`
tool_use — i.e. Claude has proposed a plan and is waiting on the user's
"1" (accept) / "2" (keep planning) reply in Plan Mode. The bubble mounts
in-stream as the last child of the message-content wrapper (sibling to
`WipBubble` from patch #51), not as a sidebar panel — it belongs in the
conversation flow because it represents a moment where Claude is asking
for input.

**Detection mechanism** (Ashley-verified against a live JSONL, 2026-07-18):
every ExitPlanMode confirmation prompt appears as an assistant turn with
`stop_reason: "tool_use"` and a `tool_use` content block where
`name === "ExitPlanMode"`. The block carries an `id` (the tool_use_id) and
inputs `plan` (markdown body) + `planFilePath`. It stays unmatched until
Ashley replies — at which point a subsequent user turn's `content[]`
includes a `{type:"tool_result", tool_use_id:"toolu_..."}` block closing
the pair. That's exactly the same shape patch #61 uses to correlate
backgrounded Agent invocations.

**Backend approach** — mirror patch #61's parallel raw-line scan alongside
`parseSessionLine` in the same `tailSessionFile` onLine callback. Do NOT
add a new SSH poller and do NOT touch `session-file-parser.ts` (RENDER-01
HARD LOCK strips tool_use / tool_result blocks structurally at the parser,
so they never reach the parser's output). A second `JSON.parse` per line
is trivially cheap; in fact this patch reuses the SAME `JSON.parse(line)`
call that patch #61 already performs — we just add two more `if` branches
that read from the parsed `obj`. Track pending plan prompts in a
per-connection closure `Map<toolUseId, {planFilePath, ts}>`, dedup-emit a
`{type:"plan_pending", pending}` frame when the serialized shape changes.

**Frontend approach** — new file `PlanPendingBubble.tsx` mirroring the
shape of `WipBubble.tsx`: assistant-side aligned bubble with a static
`ClipboardList` glyph and one line of text explaining the "reply `1` /
`2`" contract. NO plan content is displayed (Ashley's explicit ask —
"compact WipBubble-style indicator only"). Mounted by PrettyView as a
sibling to WipBubble at the tail of the content wrapper; the two can
show simultaneously (edge case, but no reason to gate them mutually).

**Scope** — indicator only. NOT the full plan content, NOT a preview,
NOT auto-accept/decline buttons, NOT reading the on-disk plan file at
`planFilePath`. The `planFilePath` is tracked in backend state (cheap,
kept alongside `ts` for potential future use) but currently unused by
the frontend. If a future patch wants to render the plan body inline,
the `planFilePath` becomes the read source (respecting RENDER-01 —
markdown-only, no tool blocks).

**Accepted risk**: an orphaned `ExitPlanMode` tool_use from a crashed
Claude Code session persists as "pending" indefinitely because no
`tool_result` will ever arrive. Same class of risk as patch #61's
backgrounded-agents map. Accepted for now; would be fixable with
`claude-code-trace`'s 60s file-mtime staleness threshold if it ever
bites — apply once, apply everywhere in the same file (patch #61 would
adopt the same fallback).

**Deploy**: do NOT deploy this patch. Joins the pending-patch batch after
#60 (already holds #61 and #62). Deploy happens later when Ashley
green-lights the batch; the AGENTS.md write-up in `~/AGENTS.md` happens
AT PIN time as part of that batch deploy, not now.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/backend/claude-session/claude-session-server.ts
@src/ui/api/claude-session-api.ts
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/WipBubble.tsx
@src/ui/features/pretty-view/HarnessTasksPanel.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Backend — parallel raw-line scan + WS emit for plan-pending</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <action>
Add per-connection state locals for the plan-pending scan, alongside the
existing `backgroundedAgents*` locals patch #61 introduced.

**Insertion point 1 (state) — after line 147** (right after the
`let backgroundedAgentsLastSerialized = "[]";` declaration, before
`let stopped = false;`). Insert this block:

    // Plan-pending tracking (patch #63): parent-JSONL scan for
    // ExitPlanMode tool_use blocks (Claude asking Ashley to accept /
    // keep-planning in Plan Mode), paired against subsequent
    // tool_result blocks by tool_use_id. Emit on serialized-change
    // only. `pendingPlansLastSerialized` is initialized to "null" (not
    // "") so a JSONL with no unmatched ExitPlanMode produces net-zero
    // emits after the initial `tail -F -n +1` replay — the emit shape
    // when pending is null is `{ type: "plan_pending", pending: null }`
    // and JSON.stringify(null) === "null", so matching the initial
    // sentinel to "null" suppresses the spurious first empty emit.
    const pendingPlans = new Map<
      string,
      { planFilePath: string; ts: number }
    >();
    let pendingPlansLastSerialized = "null";

**Insertion point 2 (teardown) — inside `teardownPane`, around line 159**,
right after the `harnessTasksLastSerialized = null;` line and before the
`if (tailHandle)` block. Insert these two lines:

    pendingPlans.clear();
    pendingPlansLastSerialized = "null";

**Insertion point 3 (raw-line scan) — inside the `tailSessionFile` onLine
callback** at lines 524-635. Patch #61 already established the pattern:
a `try { const obj = JSON.parse(line) as {...}; ... } catch { ... }`
block that runs BEFORE `const parsed = parseSessionLine(line);`.

Extend the EXISTING patch-#61 try block (do NOT add a second
`JSON.parse` — reuse the `obj` and `content` variables patch #61
already destructures). The exact site: after the closing brace of the
patch-#61 `else if (obj?.type === "user" && Array.isArray(content)) { ... }`
branch at ~line 598, and BEFORE the `const agents = Array.from(...)`
line at ~line 599 that ends the #61 emit block. Insertion point is a
"sibling scan" that reads from the same `obj` / `content`.

Add this block (matching the surrounding 2-space indentation, which is
inside the try wrapper):

    // Plan-pending scan (patch #63). Reuses `obj` + `content` from the
    // patch-#61 backgrounded-agents scan above; do NOT re-parse.
    //   - assistant turn whose content[] contains a tool_use block with
    //     name === "ExitPlanMode" → pending; keyed by tool_use.id.
    //   - user turn whose content[] contains a tool_result with matching
    //     tool_use_id → cleared. (The patch-#61 branch already iterates
    //     tool_result blocks for its Agent correlation; adding one more
    //     `pendingPlans.delete(id)` call in the same loop is the cheap
    //     option, but for readability we do a fresh iteration here — the
    //     line volume is low enough that it does not matter.)
    if (obj?.type === "assistant" && Array.isArray(content)) {
      for (const block of content as unknown[]) {
        const b = block as {
          type?: string;
          name?: string;
          id?: string;
          input?: { planFilePath?: unknown };
        };
        if (
          b?.type === "tool_use" &&
          b?.name === "ExitPlanMode" &&
          typeof b?.id === "string"
        ) {
          pendingPlans.set(b.id, {
            planFilePath:
              typeof b.input?.planFilePath === "string"
                ? b.input.planFilePath
                : "",
            ts:
              typeof obj.timestamp === "string"
                ? Date.parse(obj.timestamp) || Date.now()
                : Date.now(),
          });
        }
      }
    } else if (obj?.type === "user" && Array.isArray(content)) {
      for (const block of content as unknown[]) {
        const b = block as { type?: string; tool_use_id?: string };
        if (
          b?.type === "tool_result" &&
          typeof b?.tool_use_id === "string"
        ) {
          pendingPlans.delete(b.tool_use_id);
        }
      }
    }
    // Only one ExitPlanMode can be pending at a time in practice (Claude
    // Code's Ink UI serializes Plan Mode prompts), so taking any entry
    // (via `.values().next()`) is correct. If somehow more than one
    // survives, we still emit a stable answer — whichever entry the map
    // returns first — until one is closed.
    const pendingIter = pendingPlans.values().next();
    const currentPending = pendingIter.done
      ? null
      : { planFilePath: pendingIter.value.planFilePath };
    const planSerialized = JSON.stringify(currentPending);
    if (planSerialized !== pendingPlansLastSerialized) {
      pendingPlansLastSerialized = planSerialized;
      try {
        ws.send(
          JSON.stringify({
            type: "plan_pending",
            pending: currentPending,
          }),
        );
      } catch {
        /* ws may be mid-close */
      }
    }

**Also extend the WS protocol comment at the top of the file**
(the `server -> client:` comment block near lines 22-29). Add one line
for the new event type, placed after the `backgrounded_agents` line and
before `tail_error`:

     *     { type: "plan_pending", pending }                        // unmatched ExitPlanMode tool_use in the parent JSONL — non-null when Claude is waiting on the user's "1"/"2" Plan Mode reply

Do not renumber or move the surrounding comment lines.

**Do not touch the harness-tasks poller** — it lives in a separate
`setInterval` at line 475 and is orthogonal to this scan.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; npx tsc --noEmit 2&gt;&amp;1 | grep -E 'claude-session-server\.ts' | head -20 ; echo EXIT=$?</automated>
  </verify>
  <done>
- The `pendingPlans` map + `pendingPlansLastSerialized` init are declared
  after line 147.
- `teardownPane` clears both alongside the existing state clears.
- The raw-line scan sits INSIDE the try block that patch #61 opened, uses
  the same `obj` + `content` variables, and emits `plan_pending` only when
  the JSON.stringify of the current-pending shape changes.
- The WS protocol comment lists the new event alongside the existing ones.
- `npx tsc --noEmit` reports no new errors in this file.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire type — add plan_pending to the ClaudeSessionServerEvent union</name>
  <files>src/ui/api/claude-session-api.ts</files>
  <action>
In `src/ui/api/claude-session-api.ts`, add a new event type AFTER the
existing `BackgroundedAgentsEvent` (lines 71-74) and BEFORE
`TailErrorEvent` (line 76):

    export type PlanPendingEvent = {
      type: "plan_pending";
      pending: { planFilePath: string } | null;
    };

No new interface type is needed — the inline object shape is simple
enough to inline in the event definition (this matches the compact
posture patch #52's `ContextPctEvent` uses for `pct: number`).

Then extend the `ClaudeSessionServerEvent` union (currently lines 87-95)
to include `| PlanPendingEvent`, inserted between
`BackgroundedAgentsEvent` and `TailErrorEvent`:

    export type ClaudeSessionServerEvent =
      | SessionMetaEvent
      | MessageEvent
      | InactiveEvent
      | ContextPctEvent
      | HarnessTasksEvent
      | BackgroundedAgentsEvent
      | PlanPendingEvent
      | TailErrorEvent
      | ErrorEvent;

Do not touch any other export in this file. Do not export
`PlanPendingEvent` from a shared barrel — the file has no barrel; each
event type is a named export.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; grep -c 'PlanPendingEvent' src/ui/api/claude-session-api.ts</automated>
  </verify>
  <done>
- `PlanPendingEvent` is exported with the exact shape `{ type:
  "plan_pending"; pending: { planFilePath: string } | null }`.
- The `ClaudeSessionServerEvent` union includes `PlanPendingEvent`
  between `BackgroundedAgentsEvent` and `TailErrorEvent`.
- `grep -c 'PlanPendingEvent'` returns exactly 2 (declaration + union).
  </done>
</task>

<task type="auto">
  <name>Task 3: New file — PlanPendingBubble component</name>
  <files>src/ui/features/pretty-view/PlanPendingBubble.tsx</files>
  <action>
Create `src/ui/features/pretty-view/PlanPendingBubble.tsx`. Mirror
`WipBubble.tsx` structure — same outer flex-justify-start container,
same inner bubble classes matching `ChatMessage.tsx`'s assistant
treatment — but replace the animated `Loader2` with a STATIC
`ClipboardList` glyph (from lucide-react) and add a single line of
explanatory text.

Static glyph rationale (mirrors patch #53's rationale on
HarnessTasksPanel): the motion channel is owned by `WipBubble`
("Claude is working"). Plan-pending is the OPPOSITE state — Claude
has stopped and is waiting on the user — so a spinner would be
semantically wrong. `ClipboardList` reads as "here is a document /
plan awaiting a decision", which matches the situation.

Full contents:

    // Patch #63: plan-mode pending indicator bubble for the pretty view.
    //
    // Mounted by PrettyView.tsx as a sibling of WipBubble at the tail of
    // the content wrapper when the claude-session WebSocket reports
    // {type:"plan_pending", pending: {...}} with a non-null pending
    // object. Unmounted when the session returns pending: null (Ashley
    // has replied "1" or "2" and Claude Code recorded the tool_result).
    //
    // The visual is intentionally compact and text-light: a
    // ClipboardList glyph in an assistant-aligned bubble matching
    // ChatMessage's assistant treatment, plus one line explaining the
    // reply contract. No plan body is shown — this is a status
    // indicator, not a preview. The planFilePath is not displayed
    // either (Plan Mode is between Ashley and Claude Code; the pretty
    // view surfaces only THAT the prompt is open).
    //
    // Static ClipboardList (not a spinner) — the motion channel is
    // owned by WipBubble. A spinner reads as "Claude is working";
    // plan-pending is the opposite ("Claude is waiting on you"), so
    // a spinner would be semantically wrong. This mirrors patch #53's
    // static-glyph choice for HarnessTasksPanel's in-progress rows.

    import { ClipboardList } from "lucide-react";
    import { cn } from "@/lib/utils";

    export function PlanPendingBubble() {
      return (
        <div className={cn("flex", "justify-start")}>
          <div
            role="status"
            aria-label="Plan waiting for your approval"
            className={cn(
              "rounded-lg px-3 py-2 leading-relaxed",
              "bg-card text-card-foreground border border-border",
              "flex items-center gap-2 text-sm",
            )}
          >
            <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Plan proposed — reply <code>1</code> to accept,{" "}
              <code>2</code> to keep planning
            </span>
          </div>
        </div>
      );
    }

Note: use `<code>` (not `<kbd>` or backticks in prose) so the `1` and
`2` render with the fork's monospace opt-back styling that patch #48
already established for inline code in the pretty-view prose surface.
The tokens do not need `className` — `ChatMessage.tsx`'s `prose-code`
rules apply globally within the pretty-view render tree, and the
default browser `<code>` styling is fine when they do not.
  </action>
  <verify>
    <automated>test -f /home/ubuntu/skynet/src/ui/features/pretty-view/PlanPendingBubble.tsx &amp;&amp; grep -c 'ClipboardList\|PlanPendingBubble' /home/ubuntu/skynet/src/ui/features/pretty-view/PlanPendingBubble.tsx</automated>
  </verify>
  <done>
- File exists at `src/ui/features/pretty-view/PlanPendingBubble.tsx`.
- Exports a single `PlanPendingBubble` React component.
- Imports `ClipboardList` from lucide-react (not `Loader2`, not any
  other animated glyph).
- Contains `role="status"` + `aria-label="Plan waiting for your approval"`
  on the inner bubble.
- Text reads exactly: `Plan proposed — reply {code}1{/code} to accept,
  {code}2{/code} to keep planning` (with the ` — ` em-dash separator
  matching the copy convention used in other pretty-view strings).
- No props are exported / used — the component is a pure indicator.
  </done>
</task>

<task type="auto">
  <name>Task 4: Wire bubble into PrettyView</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
Modify `src/ui/features/pretty-view/PrettyView.tsx`:

**Step 1 — import the new component.** After the existing
`import { WipBubble } from "./WipBubble";` (line 14) add:

    import { PlanPendingBubble } from "./PlanPendingBubble";

Insert order: keep the import next to `WipBubble` so the "in-stream
indicator bubbles" group visually — the two components share the
tail-of-content-wrapper mount site, so grouping them signals that.

**Step 2 — add state hook.** After the existing `backgroundedAgents`
state hook (lines 101-103) but before the `wipActive` comment
(line 104), insert a new state hook with a matching comment style:

    // Currently-pending ExitPlanMode prompt from the parent JSONL
    // (patch #63). Backend emits `pending: {...}` when Claude is
    // waiting on the user's "1"/"2" Plan Mode reply, and `pending:
    // null` when the tool_result closes the pair. Only the presence
    // of a pending value drives the indicator — `planFilePath` is
    // tracked but not displayed (Plan Mode is between Ashley and
    // Claude Code; pretty view surfaces only THAT the prompt is open).
    const [planPending, setPlanPending] = useState<
      { planFilePath: string } | null
    >(null);

**Step 3 — reset state on `(hostId, tmuxSession)` change.** In the mount
effect at ~line 116-125, add a reset line for `planPending` immediately
after `setBackgroundedAgents([]);` (line 124):

    setPlanPending(null);

**Step 4 — add WS handler case.** In the switch statement at
~line 152-189, add a new case AFTER the `backgrounded_agents` case
(lines 175-178) and BEFORE the `tail_error` case (~line 179):

    case "plan_pending": {
      setPlanPending(parsed.pending);
      break;
    }

**Step 5 — mount the bubble at the tail of the content wrapper.** At
line 254, the existing render is:

    {wipActive && <WipBubble />}

Immediately below that line (still inside the `<div ref={contentRef}
className="flex flex-col gap-3">` wrapper opened on line 250), add:

    {planPending && <PlanPendingBubble />}

**Order rationale**: WipBubble first, PlanPendingBubble second. Both
conditions can be true simultaneously (Claude just finished emitting
the ExitPlanMode tool_use → assistant turn done → PTY idle detector
flips `isIdle` to true → WipBubble unmounts → PlanPendingBubble stays
until reply). In the edge where both mount at once (very short window
before the idle threshold fires), showing WipBubble ABOVE PlanPendingBubble
reads correctly: "still working" followed by "here is the plan waiting
for you". Do NOT gate one against the other.

**Do NOT touch:**
- The `status === "streaming"` gate on the panel mounts below (line
  294 and 309) — those gates exist to keep panels hidden during
  connecting / inactive / error states; the in-stream bubbles at
  line 254 already inherit the same gate via the enclosing
  `(status === "streaming" || (status === "connecting" && ... ))`
  block starting at line 240.
- The `contentRef` inner wrapper's `className` (`flex flex-col gap-3`)
  — the bubble is a flex-child and inherits the same `gap-3` spacing
  as chat messages and WipBubble.
- Any of the `BackgroundedAgentsPanel` / `HarnessTasksPanel` wiring
  from patches #52 and #61.
  </action>
  <verify>
    <automated>cd ~/skynet &amp;&amp; grep -c 'PlanPendingBubble\|planPending' src/ui/features/pretty-view/PrettyView.tsx</automated>
  </verify>
  <done>
- `PlanPendingBubble` is imported after `WipBubble` on ~line 15.
- `planPending` state hook is added after the `backgroundedAgents` hook.
- `setPlanPending(null)` is called in the mount-effect reset block.
- The switch has a `case "plan_pending":` that calls
  `setPlanPending(parsed.pending)`.
- The mount site is inside the `contentRef` wrapper, immediately after
  the `{wipActive && <WipBubble />}` line, gated on `planPending`
  (not on `planPending !== null` — the truthiness gate is fine and
  matches surrounding style).
- `grep -c 'PlanPendingBubble\|planPending'` returns ≥5 (import + type
  in useState + reset call + case body + JSX mount + closing tag).
  </done>
</task>

</tasks>

<verification>
Post-execution checks:

1. **Type check** (from `~/skynet` root):
   ```
   cd ~/skynet && npx tsc --noEmit
   ```
   Expect zero errors. Any error touching the four files listed above
   is a plan bug — fix in-file, do NOT relax types.

2. **Build check** (from `~/skynet` root):
   ```
   cd ~/skynet && npm run build
   ```
   Expect clean build. This is what `build-skynet.sh` runs inside the
   image; verifying it here catches problems before touching Docker.

3. **git diff --stat** should show exactly four files:
   - `src/backend/claude-session/claude-session-server.ts` — modified
   - `src/ui/api/claude-session-api.ts` — modified
   - `src/ui/features/pretty-view/PlanPendingBubble.tsx` — NEW
   - `src/ui/features/pretty-view/PrettyView.tsx` — modified

4. **Compiled invariants** (only after a subsequent deploy — deferred):
   ```
   docker exec skynet grep -c 'type: "plan_pending"' /app/dist/backend/backend/claude-session/claude-session-server.js
   ```
   Expect ≥1 (the emit call).
   ```
   docker exec skynet grep -c 'pendingPlans' /app/dist/backend/backend/claude-session/claude-session-server.js
   ```
   Expect ≥3 (Map declaration + set + delete + iter + emit — after
   minification the count depends on Vite's mangler; anything ≥3 confirms
   the state machine landed).

5. **Do NOT deploy.** Per Ashley's DEPLOY DISCIPLINE (tina.md):
   deploy is a separate ask that requires explicit go-ahead. This
   patch joins the pending-batch-post-60 alongside #61 and #62;
   the batch deploy happens later with the mandatory deadman +
   green-light protocol.

## Commit convention (fork-specific)

Two atomic commits, mirroring patch #61's shape:

1. **Code commit** (touches the 4 source files only):
   ```
   feat(pretty-view): plan-mode pending indicator (patch #63)
   ```

2. **Docs commit** (touches `.planning/quick/260718-8tk-.../` files
   and STATE.md updates only):
   ```
   docs(260718-8tk): PLAN + SUMMARY for patch #63 plan-mode pending indicator
   ```

Do NOT combine into one commit. Do NOT touch AGENTS.md in either commit —
the AGENTS.md entry lands at pin time as part of the eventual batch
deploy, not now.

## Live smoke (deferred — after eventual batch deploy)

- Open pretty view on a pane where a Claude Code session is running.
- In that session prompt Claude to enter Plan Mode (Shift-Tab twice) and
  ask for a plan. When Claude proposes the plan, the `ExitPlanMode`
  tool_use lands in the JSONL.
- Within ~1s the PlanPendingBubble appears at the tail of the message
  stream, showing "Plan proposed — reply `1` to accept, `2` to keep
  planning".
- Type `1` or `2` in the terminal (or via ComposeBox). The `tool_result`
  lands in the JSONL, the emit fires with `pending: null`, and the
  bubble disappears within ~1s.
- Regression check: WipBubble still fires correctly during Claude's
  working state; backgrounded-agents panel still fires on subagents;
  chat rendering unchanged; harness-tasks panel still fires.
</verification>

<success_criteria>
- All four files match the shapes described in the tasks.
- `npx tsc --noEmit` reports zero new errors.
- `npm run build` completes cleanly.
- The backend closure state (`pendingPlans` Map +
  `pendingPlansLastSerialized`) is declared alongside patch #61's
  backgrounded-agents state, cleared in `teardownPane`, and the emit
  runs on serialized-change inside the same try block that patch #61's
  scan opened.
- The frontend has a `PlanPendingBubble` component that mirrors
  `WipBubble.tsx`'s shape but uses a static `ClipboardList` glyph and
  a text line explaining the "reply `1` / `2`" contract.
- PrettyView threads the WS event through a `planPending` state hook
  and mounts the bubble as a sibling of WipBubble inside the content
  wrapper.
- Two atomic commits land: one code, one docs. No AGENTS.md changes.
- No deploy is initiated.
</success_criteria>

<output>
Create `.planning/quick/260718-8tk-patch63-plan-mode-pending-indicator/260718-8tk-SUMMARY.md`
when execution completes. Follow the shape of patch #61's SUMMARY.md
(same directory sibling for reference) — one paragraph on what shipped,
one on files touched, one on invariants, one on deferred deploy notes.
</output>
