---
phase: 260717-vbw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/wip-classifier.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/WipBubble.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
requirements:
  - patch-51-wip-indicator
must_haves:
  truths:
    - "Pretty view shows a spinner bubble at the bottom of the message list while Claude Code is currently working (WIP=true)"
    - "The spinner disappears the moment Claude Code returns control to the user (WIP=false)"
    - "WIP state is derived from the JSONL structure state machine (no polling, no PTY inspection, no new I/O)"
    - "WIP frames are emitted on the existing claude-session WebSocket only on state transitions plus once as initial state"
    - "The five changes ship as exactly five atomic conventional-commits, one per file"
    - "The tree builds locally after all five commits (`npm run build` succeeds)"
    - "No deploy, no /opt/skynet modification, no docker compose invocation, no AGENTS.md update — this is a source-only patch"
  artifacts:
    - path: "src/backend/claude-session/wip-classifier.ts"
      provides: "Pure helper classifyWipTransition(rawObj) → 'start' | 'end' | null"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "Emits {type:'wip', active:boolean} frames on the WS on transitions + initial state"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "WipEvent variant added to the ClaudeSessionServerEvent discriminated union"
    - path: "src/ui/features/pretty-view/WipBubble.tsx"
      provides: "Assistant-side aligned bubble with a Loader2 spinner"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "wipActive state + WipBubble mount as last child of the content wrapper"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts"
      to: "src/backend/claude-session/wip-classifier.ts"
      via: "import { classifyWipTransition }"
      pattern: "classifyWipTransition"
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/features/pretty-view/WipBubble.tsx"
      via: "import { WipBubble }"
      pattern: "WipBubble"
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/api/claude-session-api.ts"
      via: "case 'wip' in the WS on-message switch"
      pattern: "case \"wip\""
---

<objective>
Patch #51 for the Skynet fork: add a work-in-progress indicator to pretty view.

While Claude Code is working (making an API call, running a tool, thinking), a
spinner bubble appears at the bottom of the pretty-view message list. The
moment Claude Code returns control to the user, the spinner disappears. The
WIP state is derived from the JSONL structure state machine — the same JSONL
the pretty-view backend already tails — so this piggybacks on existing I/O
with zero new SSH connections, no polling, and no PTY inspection.

Purpose: today, when Claude Code takes 30-60s to finish a tool call, Ashley
has no visual signal in pretty view that "the session is still moving." She
either wonders if it crashed or context-switches to tmux mode to check. A
persistent tail-driven spinner solves this structurally.

Output: 5 atomic commits on `feat/tab-title-from-tmux`, ~85 lines net, no
deploy. Local `npm run build` must succeed before the plan is done.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/ubuntu/skynet/CLAUDE.md
@/home/ubuntu/skynet/AGENTS.md
@/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts
@/home/ubuntu/skynet/src/backend/claude-session/session-file-parser.ts
@/home/ubuntu/skynet/src/ui/api/claude-session-api.ts
@/home/ubuntu/skynet/src/ui/features/pretty-view/PrettyView.tsx
@/home/ubuntu/skynet/src/ui/features/pretty-view/ChatMessage.tsx

# Constraints (Ashley, 2026-07-17):
# - Do NOT deploy. Do NOT touch /opt/skynet. Do NOT run docker compose.
# - Do NOT arm any deadman timer. Do NOT update AGENTS.md.
# - Working directory MUST be /home/ubuntu/skynet on branch feat/tab-title-from-tmux.
# - Exactly 5 atomic commits, one per file, using the conventional-commits prefixes
#   documented in the task actions below.
# - `session-file-parser.ts` is HANDS OFF. The classifier goes in a sibling file.

# JSONL turn state machine (settled by design; do not renegotiate):
# - type:"user" + NOT isMeta:true + NOT a harness wrapper
#   (<task-notification>…</task-notification> or <system-reminder>…</system-reminder>)
#   → "start"  (WIP=true: API call inbound OR tool_result being processed)
# - type:"assistant" with any content block of type:"tool_use"
#   → "start"  (WIP=true: tool call about to run)
# - type:"assistant" with content blocks that are text-only
#   (has at least one type:"text", has NO type:"tool_use")
#   → "end"    (WIP=false: harness returned control)
# - type:"assistant" with only type:"thinking" blocks (no text, no tool_use)
#   → "start"  (WIP=true: defensive — model isn't done)
# - anything else (system events, meta, malformed) → null (no transition)
#
# Justification: the Anthropic API only returns stop_reason:"end_turn" when the
# response contains no tool_use blocks. So the assistant-text-only turn IS the
# terminal state; anything else is definitionally "still working." This is
# structurally accurate — not a heuristic.
#
# Known edge case (documented, accepted, NO code required): if Claude Code
# crashes / is killed mid-tool-call, the last JSONL event will be tool_use or
# tool_result and WIP will show forever-true until new user input. Rare;
# accepted; no fix in this patch.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add wip-classifier.ts pure helper (Commit 1/5)</name>
  <files>src/backend/claude-session/wip-classifier.ts</files>
  <action>
Create NEW file `src/backend/claude-session/wip-classifier.ts` as a sibling of
`session-file-parser.ts`. Do NOT modify `session-file-parser.ts` (it is hands
off per Ashley's directive).

Export a single pure function:

  export function classifyWipTransition(
    rawObj: Record&lt;string, unknown&gt;,
  ): "start" | "end" | null

Implementation rules (order matters — return the FIRST matching branch):

1. If `rawObj.type === "user"`:
   - If `rawObj.isMeta === true` → return `null` (meta events don't change WIP).
   - Extract text content: the message content lives at `rawObj.message.content`
     which is either a plain string OR an array of content blocks each with a
     `text` field. Concatenate all string content and check if the TRIMMED
     result starts+ends with either wrapper tag:
       `<task-notification>…</task-notification>`
       `<system-reminder>…</system-reminder>`
     If so → return `null` (harness wrapper, not real user input).
   - Otherwise → return `"start"` (real user turn: WIP begins).

2. If `rawObj.type === "assistant"`:
   - Extract the content blocks array from `rawObj.message.content`. If it is
     not an array, return `null` (malformed / unexpected shape).
   - Let `hasToolUse = blocks.some(b => b?.type === "tool_use")`.
   - Let `hasText = blocks.some(b => b?.type === "text")`.
   - If `hasToolUse === true` → return `"start"` (tool call about to run).
   - Else if `hasText === true` → return `"end"` (assistant returned control).
   - Else → return `"start"` (only thinking / other → defensive; still working).

3. Anything else (unknown top-level type, malformed, system events) → `null`.

Defensive coding: every dereference of a possibly-undefined nested property
must be guarded (use optional chaining + `typeof` checks). The function
must never throw on any input — return `null` on any structural surprise.
Do NOT use `any`; use `Record<string, unknown>` and narrow with typeof
checks. No side effects, no I/O, no console logs.

Mirror the mandatory-initial-read: this is a fork-only file, use TypeScript
strict mode conventions already established in `session-file-parser.ts`
(no semicolons omitted, ESM `.js` imports where applicable — this file has
no imports).

After writing, stage ONLY this file and commit with:

  git add src/backend/claude-session/wip-classifier.ts
  git commit -m "feat(pretty-view): add wip-classifier for JSONL turn state machine"

Do NOT include a Claude co-author line — Ashley's convention is bare
conventional-commits messages on fork branches (verify by running
`git log --oneline -6` and matching the style).
  </action>
  <verify>
    <automated>test -f src/backend/claude-session/wip-classifier.ts &amp;&amp; git log -1 --pretty=%s | grep -qE '^feat\(pretty-view\): add wip-classifier'</automated>
  </verify>
  <done>
File exists at the correct path, exports `classifyWipTransition`, contains no
`any` types, contains no side effects, one commit landed on the current
branch with the message prefix `feat(pretty-view): add wip-classifier`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire WIP tracking into claude-session-server.ts (Commit 2/5)</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <action>
Edit `src/backend/claude-session/claude-session-server.ts` to derive and emit
WIP transitions from the tailed JSONL.

Concrete edits:

1. Add an import next to the existing `parseSessionLine` / `tailSessionFile`
   imports:
     import { classifyWipTransition } from "./wip-classifier.js";
   (Note the `.js` extension — matches the ESM convention used by the sibling
   imports.)

2. In the WS connection closure (inside `wss.on("connection", ...)` — near
   where `sshConn` / `tailHandle` / `stopped` are declared, around line 120),
   add two new state variables:
     let wipActive: boolean | null = null;
     let initialWipEmitted = false;

3. In the `tailHandle = tailSessionFile(...)` call — inside the per-line
   callback `(line: string) => { ... }` (around line 336) — add WIP handling
   BEFORE the existing `const parsed = parseSessionLine(line);` call:

   a. Parse the raw JSON: wrap in try/catch. On parse error, DO NOT skip
      the parser call below — just skip the WIP classification for this
      line (`continue` semantics — set a boolean or just guard the WIP
      block). The existing parseSessionLine has its own defensive handling.

   b. If the raw JSON parsed, call `classifyWipTransition(rawObj)` →
      `"start" | "end" | null`.
      - If `null`: no state change; do nothing.
      - Otherwise, compute nextState:
          const nextState = transition === "start" ? true : false;
      - Emission rules:
        - If `!initialWipEmitted`: emit `{type: "wip", active: nextState}`,
          set `initialWipEmitted = true`, set `wipActive = nextState`.
        - Else if `nextState !== wipActive`: emit
          `{type: "wip", active: nextState}` and update `wipActive`.
        - Else: no emit (state unchanged after initial emission — prevents
          WS chatter).

   c. AFTER the WIP block, always run the existing `parseSessionLine(line)`
      and message-emission code unchanged. WIP handling is additive, not a
      replacement.

4. The `ws.send(JSON.stringify({type: "wip", active: nextState}))` call must
   be guarded with the same `stopped || ws.readyState !== WebSocket.OPEN`
   check the existing message emission uses, and wrapped in a try/catch
   with a silent-drop comment matching the existing style
   (`/* ws may be mid-close; drop */`).

5. Extend the wire-protocol comment block at the top of the file (the
   JSDoc-style comment that lists frame types) to add the new frame:
     { type: "wip", active }                                    // work-in-progress state
   Place it after the `message` line and before the `inactive` line, and
   note in a short parenthetical that it is emitted on transitions plus
   once as initial state.

6. Do NOT touch the FALLBACK-01 inactive path — inactive sessions do not
   emit WIP (they never start a tail).

7. Do NOT reset `initialWipEmitted` on tail restart within the same WS
   connection — the initial-emission is per-connection, not per-tail.
   Pane switches already tear down and reconnect at the WS level via a
   fresh `connectToPane`, so the caller controls session boundaries.

Stage only this file and commit:

  git add src/backend/claude-session/claude-session-server.ts
  git commit -m "feat(pretty-view): emit WIP transitions on the claude-session WS"
  </action>
  <verify>
    <automated>grep -q 'classifyWipTransition' src/backend/claude-session/claude-session-server.ts &amp;&amp; grep -q '"wip"' src/backend/claude-session/claude-session-server.ts &amp;&amp; grep -q 'initialWipEmitted' src/backend/claude-session/claude-session-server.ts &amp;&amp; git log -1 --pretty=%s | grep -qE '^feat\(pretty-view\): emit WIP transitions'</automated>
  </verify>
  <done>
The file imports `classifyWipTransition` from `./wip-classifier.js`, declares
`wipActive` and `initialWipEmitted` in the WS closure, calls the classifier
per line before the existing parser call, emits `{type:"wip", active}` on
transitions and once as initial state, guards emission with the same
readyState check the existing sends use. Second commit landed with the
message prefix `feat(pretty-view): emit WIP transitions`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add WipEvent to the wire-type union (Commit 3/5)</name>
  <files>src/ui/api/claude-session-api.ts</files>
  <action>
Edit `src/ui/api/claude-session-api.ts` to widen the client-side wire-type
discriminated union so TypeScript recognizes the new `wip` frame.

Concrete edits:

1. Add a new type export just before the `ClaudeSessionServerEvent` union
   declaration (around line 55), matching the surrounding style:

     export type WipEvent = {
       type: "wip";
       active: boolean;
     };

2. Extend the union at line ~55-60 to include `WipEvent`:

     export type ClaudeSessionServerEvent =
       | SessionMetaEvent
       | MessageEvent
       | WipEvent
       | InactiveEvent
       | TailErrorEvent
       | ErrorEvent;

   Placement inside the union does not matter for TypeScript, but keep the
   ordering consistent with the docstring at the top of the file (SessionMeta
   → Message → WIP → Inactive → TailError → Error, in "typical connection
   lifecycle" order).

3. No changes to `openClaudeSessionSocket`, `ConnectToPanePayload`, or any
   other export.

Stage only this file and commit:

  git add src/ui/api/claude-session-api.ts
  git commit -m "feat(pretty-view): wire the wip message type into claude-session-api"
  </action>
  <verify>
    <automated>grep -q 'type WipEvent' src/ui/api/claude-session-api.ts &amp;&amp; grep -q '| WipEvent' src/ui/api/claude-session-api.ts &amp;&amp; git log -1 --pretty=%s | grep -qE '^feat\(pretty-view\): wire the wip message type'</automated>
  </verify>
  <done>
The `WipEvent` type is exported with `type: "wip"` and `active: boolean`, and
it is a member of the `ClaudeSessionServerEvent` union. Third commit landed
with the message prefix `feat(pretty-view): wire the wip message type`.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add WipBubble.tsx spinner component (Commit 4/5)</name>
  <files>src/ui/features/pretty-view/WipBubble.tsx</files>
  <action>
Create NEW file `src/ui/features/pretty-view/WipBubble.tsx` — a minimal
presentational component that renders an assistant-side aligned bubble with
a spinner. Match `ChatMessage.tsx`'s assistant-side treatment.

Concrete requirements:

1. Import `Loader2` from `lucide-react` and `cn` from `@/lib/utils` (mirror
   ChatMessage.tsx's import style).

2. Export a `WipBubble` component with no props. It renders:

   - Outer `<div className={cn("flex", "justify-start")}>` — assistant-side
     left-alignment, exactly matching ChatMessage's assistant outer wrapper.

   - Inner bubble div with the SAME class list ChatMessage uses for the
     assistant branch, MINUS the prose typography classes (there is no
     markdown content). Specifically:
       "rounded-lg px-3 py-2 leading-relaxed"
       "bg-card text-card-foreground border border-border"
     The visual should be a small pill — sized to just fit the spinner
     comfortably. Use `h-4 w-4` for the spinner so the bubble stays
     compact (matches ChatMessage's `text-sm` rhythm).

   - Body: `<Loader2 className="h-4 w-4 animate-spin" aria-label="Claude is working" />`

   - Add `role="status"` on the outer bubble div so assistive tech
     announces the state change.

3. Include a short docstring comment at the top of the file that:
   - Names patch #51.
   - Explains this bubble is mounted by PrettyView.tsx when the WS
     reports `{type:"wip", active:true}`.
   - Notes that the visual is intentionally text-free (spinner is
     self-explanatory in context).

4. Do NOT accept props for now; hardcode the visual. Ashley's design is
   settled: no text label, no size variants, no theme knobs.

Stage only this file and commit:

  git add src/ui/features/pretty-view/WipBubble.tsx
  git commit -m "feat(pretty-view): add WipBubble component (spinner + assistant-side alignment)"
  </action>
  <verify>
    <automated>test -f src/ui/features/pretty-view/WipBubble.tsx &amp;&amp; grep -q 'Loader2' src/ui/features/pretty-view/WipBubble.tsx &amp;&amp; grep -q 'animate-spin' src/ui/features/pretty-view/WipBubble.tsx &amp;&amp; grep -q 'aria-label' src/ui/features/pretty-view/WipBubble.tsx &amp;&amp; git log -1 --pretty=%s | grep -qE '^feat\(pretty-view\): add WipBubble component'</automated>
  </verify>
  <done>
File exists at the correct path, exports `WipBubble`, uses `Loader2` with
`animate-spin`, has an `aria-label`, matches ChatMessage's assistant-side
outer wrapper alignment (`flex` + `justify-start`) and the assistant bubble
inner styling (`bg-card text-card-foreground border border-border`). Fourth
commit landed with the message prefix `feat(pretty-view): add WipBubble
component`.
  </done>
</task>

<task type="auto">
  <name>Task 5: Wire WipBubble into PrettyView + local build verification (Commit 5/5)</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
Edit `src/ui/features/pretty-view/PrettyView.tsx` to consume the new `wip`
frames and render `WipBubble` as the last child of the content wrapper.

Concrete edits:

1. Add an import next to the existing `ChatMessage` import:
     import { WipBubble } from "./WipBubble";

2. Add a new state variable next to `messages`/`status` (around line 69):
     const [wipActive, setWipActive] = useState(false);

3. Reset `wipActive` inside the mount `useEffect` reset block (around line
   80-84 where `setMessages([])`, `setStatus(...)`, etc. run):
     setWipActive(false);

4. In the WS `onmessage` switch (around line 112-137), add a new case
   for the `wip` variant:
     case "wip": {
       setWipActive(parsed.active);
       break;
     }
   Place it after the `message` case and before the `inactive` case, matching
   the ordering used in the wire-type union.

5. In the render tree, add the WipBubble mount as the LAST child of the
   `<div ref={contentRef}>` content wrapper (around line 198-202), AFTER the
   `messages.map(...)`:

     &lt;div ref={contentRef} className="flex flex-col gap-3"&gt;
       {messages.map((m) => (
         &lt;ChatMessage key={m.eventId} role={m.role} content={m.content} /&gt;
       ))}
       {wipActive &amp;&amp; &lt;WipBubble /&gt;}
     &lt;/div&gt;

   When `wipActive` is `false`, the bubble is not rendered at all — the last
   real assistant text bubble takes its natural place. The auto-scroll ratchet
   from patch #50 already observes the content wrapper via ResizeObserver, so
   the appear/disappear will re-pin correctly with no additional work.

6. Do NOT alter any other logic. Do NOT touch the ComposeBox mount, the
   inactive branch, the error banner, the jump-to-latest pill, or the
   scrollRef/contentRef wiring.

7. After the edit, stage and commit:

     git add src/ui/features/pretty-view/PrettyView.tsx
     git commit -m "feat(pretty-view): render WipBubble when session is WIP"

8. SMOKE CHECK (run all three; each must succeed):

   a. Verify commit ordering and messages:
        git log --oneline -6
      Expected output (top → bottom): the 5 new commits in reverse order
      (Commit 5 at HEAD, Commit 1 at HEAD~4), each with the correct
      `feat(pretty-view): ...` prefix.

   b. Verify the local build succeeds:
        npm run build
      Runs `vite build && tsc -p tsconfig.node.json && node -e "..."`.
      This exercises both the frontend (vite) and backend (tsc) compilation
      paths, so any TypeScript error in the new files will fail here. If
      build fails, DO NOT deploy — investigate the error, fix in an
      additional 6th commit (`fix(pretty-view): resolve build error in
      ...`) or amend if the fix is trivial to the immediately-previous
      commit. Ashley's convention preserves atomic commits; prefer a
      new fix commit over an amend unless the fix is literally a typo.

   c. Verify the auto-scroll ratchet observes the content wrapper (no
      code change — inspection only). Grep:
        grep -n 'contentRef' src/ui/features/pretty-view/use-auto-scroll.ts
      Should show the ResizeObserver attaching to `contentRef.current`.
      This confirms the WipBubble appear/disappear will trigger a
      re-pin without additional work.

9. DO NOT deploy. DO NOT run `docker compose`. DO NOT touch /opt/skynet.
   DO NOT arm a deadman. DO NOT update AGENTS.md. Ashley has explicitly
   scoped this task to source-level changes only.
  </action>
  <verify>
    <automated>grep -q 'import { WipBubble }' src/ui/features/pretty-view/PrettyView.tsx &amp;&amp; grep -q 'wipActive' src/ui/features/pretty-view/PrettyView.tsx &amp;&amp; grep -q 'case "wip"' src/ui/features/pretty-view/PrettyView.tsx &amp;&amp; git log -1 --pretty=%s | grep -qE '^feat\(pretty-view\): render WipBubble' &amp;&amp; git log --oneline -5 | grep -c 'feat(pretty-view)' | grep -q '^5$' &amp;&amp; npm run build</automated>
  </verify>
  <done>
PrettyView.tsx imports `WipBubble`, declares `wipActive` state, resets it on
mount, handles the `wip` case in the WS switch, renders `{wipActive &amp;&amp;
<WipBubble />}` as the last child of the content wrapper. Fifth commit
landed. `git log --oneline -5` shows all five `feat(pretty-view):` commits
in the correct order. `npm run build` succeeds locally. No deploy performed.
  </done>
</task>

</tasks>

<verification>
End-of-plan checks (already covered by Task 5's smoke check, restated here
for the goal-backward invariant):

1. `git log --oneline -6` shows 5 new commits at HEAD, all prefixed with
   `feat(pretty-view):` and in the exact order: add wip-classifier → emit
   WIP transitions → wire the wip message type → add WipBubble component →
   render WipBubble.

2. `npm run build` exits 0 (vite build + tsc both pass — any TypeScript
   error in the new union, the classifier signature, or the WipBubble
   component would surface here).

3. Grep confirms the interface links: `wip-classifier.ts` is imported by
   `claude-session-server.ts`; `WipEvent` is a member of the wire union;
   `WipBubble` is imported and mounted in `PrettyView.tsx`.

4. No changes to `session-file-parser.ts` (hands off per Ashley).

5. Working tree is on `feat/tab-title-from-tmux` branch (verify with
   `git branch --show-current`).

6. No files under `/opt/skynet` touched. No docker commands run. No
   AGENTS.md updates. This is source-only.
</verification>

<success_criteria>
- Five atomic conventional-commits land on `feat/tab-title-from-tmux`.
- `npm run build` succeeds after the last commit.
- The JSONL turn state machine is implemented exactly as designed: user
  turns (non-meta, non-wrapper) start WIP; assistant turns with tool_use
  start WIP; assistant turns with text-only end WIP; assistant turns with
  only thinking start WIP (defensive); everything else is null.
- The `wip` frame is emitted on transitions ONLY, plus once as initial
  state on the first classified line. No repeated emits for the same state.
- `WipBubble` is assistant-side aligned, matches ChatMessage's assistant
  bubble aesthetic (bg-card / border-border), contains a `Loader2` with
  `animate-spin`, has an `aria-label`.
- `PrettyView` renders the bubble as the last child of the content wrapper
  when `wipActive` is true, and does not render it at all when false.
- The known edge case (Claude Code crashed mid-tool-call → forever-WIP)
  is documented but has NO code fix in this patch (accepted).
- No deploy. No `/opt/skynet` change. No AGENTS.md update.
</success_criteria>

<output>
Create `/home/ubuntu/skynet/.planning/quick/260717-vbw-work-in-progress-indicator-for-pretty-vi/260717-vbw-SUMMARY.md`
when all five commits have landed and `npm run build` has succeeded. The
SUMMARY should record:
- The 5 commit hashes (from `git log --format='%h %s' -5`).
- The net line count (from `git diff HEAD~5..HEAD --shortstat`).
- Confirmation that `npm run build` succeeded.
- Explicit note: NOT deployed. Requires future deploy behind the mandatory
  15-min deadman when Ashley authorizes.
</output>
