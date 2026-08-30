---
phase: quick-260802-rps
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/plan-pending-parser.ts
  - src/backend/claude-session/plan-pending-parser.test.ts
  - src/backend/claude-session/claude-session-server.ts
autonomous: true
requirements:
  - RPS-01
must_haves:
  truths:
    - "PlanPendingBubble reliably appears in the frontend while Claude Code is awaiting user resolution of the plan-approval Ink prompt (regardless of ExitPlanModeV2Tool buffering)."
    - "PlanPendingBubble reliably disappears (pending:null) once the user resolves the prompt (approve or reject) and the Ink prompt leaves the pane."
    - "Vitest suite for the new `isPlanPending` helper is green — all 6 cases pass in isolation."
    - "`npm run build:backend` and `npm run build` both succeed with no TS errors."
    - "The legacy JSONL scan block in claude-session-server.ts remains in place, unchanged in behavior, with an inline deprecation comment explaining the V2 buffered-write discovery of 2026-08-02."
  artifacts:
    - path: "src/backend/claude-session/plan-pending-parser.ts"
      provides: "Pure `isPlanPending(paneText: string): boolean` helper — bottom-30-lines slice + `No, keep planning` marker + `Here is Claude's plan:` OR `Ready to code?` header guard."
      exports: ["isPlanPending"]
    - path: "src/backend/claude-session/plan-pending-parser.test.ts"
      provides: "Vitest suite mirroring context-pct-parser.test.ts shape — 2 positive + 4 negative cases."
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "Pane-scrape wiring: import + call `isPlanPending` inside the existing setInterval alongside `parseContextPct`, `planPendingLastSerialized` sentinel, gated WS emission of `{type:'plan_pending', pending}`, reset-on-init + reset-on-false-alarm mirror of `contextPctLastSerialized`, deprecation comment above legacy JSONL scan."
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts (setInterval pane-scrape ~lines 200-220)"
      to: "src/backend/claude-session/plan-pending-parser.ts (isPlanPending)"
      via: "import + per-tick call on same paneText already fed to parseContextPct"
      pattern: "isPlanPending\\(paneText\\)"
    - from: "src/backend/claude-session/claude-session-server.ts (WS emit site)"
      to: "src/ui/features/pretty-view/PlanPendingBubble.tsx (frontend handler)"
      via: "existing `{type:'plan_pending', pending}` WS message shape (unchanged — see case 'plan_pending' ~line 643)"
      pattern: "type:\\s*['\"]plan_pending['\"]"
    - from: "planPendingLastSerialized reset sites"
      to: "contextPctLastSerialized reset sites (~line 530 initial-connection + ~line 730 false-alarm recovery)"
      via: "grep-and-mirror — every place contextPctLastSerialized is reset to \"null\", planPendingLastSerialized gets an identical reset line"
      pattern: "contextPctLastSerialized\\s*="
---

<objective>
Fix Skynet PlanPendingBubble by replacing the effectively-dead parent-JSONL scan for `ExitPlanMode` (patch #63) with a **tmux pane screen-scrape** for the plan-approval Ink prompt. The scan is dead because Claude Code 2.1.150's `ExitPlanModeV2Tool` buffers the `tool_use` in Ink UI memory and only flushes it to the parent JSONL after the user resolves the prompt — so during the entire pending window (which is exactly when we need to render PlanPendingBubble) the JSONL has zero signal. Live confirmation on Moxie's workstation 2026-08-02: `ExitPlanMode` tool_use appeared in JSONL only 57 minutes after the model called it, at the moment Ashley approved.

Purpose: PlanPendingBubble effectively never shows today; this restores it end-to-end using the pane as the authoritative live signal, mirroring the shape and gating pattern already proven for `parseContextPct` in the same setInterval.

Output: Two new files (parser + test) and a surgical wiring edit in `claude-session-server.ts`. Backend-only change on branch `feat/tab-title-from-tmux`. Two atomic commits. COMMIT ONLY — no push, no build, no deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/backend/claude-session/context-pct-parser.ts
@src/backend/claude-session/context-pct-parser.test.ts
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/session-file-tail.ts
@src/ui/features/pretty-view/PlanPendingBubble.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (Commit A): Add pane-scrape helper `isPlanPending` + vitest suite</name>
  <files>src/backend/claude-session/plan-pending-parser.ts, src/backend/claude-session/plan-pending-parser.test.ts</files>
  <behavior>
    Vitest cases (mirror `context-pct-parser.test.ts` shape — synthetic pane strings + boolean assertions):
    - **Positive — 3-option variant (--dangerously-skip-permissions on):** pane text with `Here is Claude's plan:` header somewhere in the pane, and bottom-30 lines containing `❯ 1. Yes, and bypass permissions` / `2. Yes, proceed` / `3. No, keep planning` → `true`.
    - **Positive — 2-option variant (default, no --dangerously-skip-permissions):** pane text with `Ready to code?` header, and bottom-30 lines containing `1. Yes, proceed` / `2. No, keep planning` → `true`.
    - **Negative — header-only-no-prompt:** pane text containing `Here is Claude's plan:` earlier (as a transcript quote or model prose), no numbered-options prompt at the bottom, no `No, keep planning` marker anywhere → `false`.
    - **Negative — options-in-prose:** pane text containing the string `No, keep planning` in the middle of the pane (e.g. as prose or a code-review comment) but NOT in the bottom-30 slice, and no header → `false`. (Marker must land in the bottom slice.)
    - **Negative — empty/whitespace:** `""` and `"   \n  \n"` → `false`.
    - **Negative — random terminal output:** normal bash/tool output with no plan-mode markers → `false`.
  </behavior>
  <action>
    Create `src/backend/claude-session/plan-pending-parser.ts` as a pure helper mirroring the shape of `context-pct-parser.ts` (top-of-file docstring explaining the V2 buffered-write discovery of 2026-08-02, signature `export function isPlanPending(paneText: string): boolean`, no imports, no I/O). Implement the fingerprint as: (a) return `false` immediately for empty/whitespace pane text; (b) take the bottom ~30 lines via `paneText.split("\n").slice(-30)` — anchoring at the bottom keeps transcript quotes elsewhere in the pane from causing false positives, same rationale as `parseContextPct`'s bottom-8 slice; (c) require the load-bearing marker `No, keep planning` to appear in the bottom slice (this is the reject-option string that appears as the last numbered option in EVERY plan-approval prompt regardless of whether `--dangerously-skip-permissions` is on — the flag changes options 1/2 but not the keep-planning line); (d) additionally require one of `Here is Claude's plan:` OR `Ready to code?` to be present in the full pane text (header-anywhere is acceptable because header + bottom-slice-marker together is the reliable combination — either alone is a much weaker signal). Then create `src/backend/claude-session/plan-pending-parser.test.ts` with the six cases enumerated in `<behavior>` above, mirroring `context-pct-parser.test.ts` shape (`import { describe, it, expect } from "vitest";` + `import { isPlanPending } from "./plan-pending-parser.js";`). Do NOT touch any other file in this task. Do NOT wire into claude-session-server.ts yet — that is Task 2.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/backend/claude-session/plan-pending-parser.test.ts</automated>
  </verify>
  <done>
    Both new files exist under `src/backend/claude-session/`. All 6 vitest cases green. `plan-pending-parser.ts` has zero imports (pure helper). Git commit created with message `feat(plan-pending-parser): add pane-scrape helper for Ink plan-approval prompt` staging exactly the two new files and nothing else. NO push. NO build.
  </done>
</task>

<task type="auto">
  <name>Task 2 (Commit B): Wire `isPlanPending` into claude-session-server.ts pane-scrape</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <action>
    Surgical wiring edit in `src/backend/claude-session/claude-session-server.ts` — no behavioral change to any subsystem other than plan-pending emission. Steps:
    1. Add import: `import { isPlanPending } from "./plan-pending-parser.js";` alongside the existing `parseContextPct` import.
    2. Find the per-connection state declaration site for `contextPctLastSerialized` and add a sibling `planPendingLastSerialized` sentinel (same type, same initial value — mirror exactly).
    3. Inside the setInterval pane-scrape callback (~lines 200-220 — the same interval that already calls `parseContextPct(paneText)` and emits the `contextPct` WS message), call `isPlanPending(paneText)`. Build the emission payload as `const currentPending = isPlanPending(paneText) ? { planFilePath: "" } : null;` — use `""` for `planFilePath` because the pane text does not reliably carry the plan file path, and `PlanPendingBubble.tsx` does not use `planFilePath` for rendering anyway. Serialize (`JSON.stringify(currentPending)`) and only send `{ type: "plan_pending", pending: currentPending }` when the serialized value differs from `planPendingLastSerialized`, then update the sentinel — mirror the exact gating pattern used for the `contextPct` emission a few lines above.
    4. Grep for every assignment `contextPctLastSerialized\s*=` in the file (the ~line 530 initial-connection reset block and the ~line 730 false-alarm-recovery reset block). At EACH of those sites, add an identical mirrored line resetting `planPendingLastSerialized = "null";` — same value, same location, same pattern. Do not miss either site.
    5. Locate the legacy patch #63 JSONL scan block (~lines 1200-1270 — the block that scans the parent JSONL for unmatched `ExitPlanMode` tool_use entries). LEAVE THE SCAN CODE UNCHANGED. Insert a 5-10 line inline comment block DIRECTLY ABOVE the scan noting: (a) Claude Code 2.1.150's `ExitPlanModeV2Tool` buffers the `tool_use` in Ink UI memory and only flushes it to the parent JSONL when the user resolves the plan-approval prompt (discovered 2026-08-02 on Moxie's workstation — 57-minute gap between model call and JSONL write); (b) as a result this JSONL scan is effectively dead code for pending-window detection — during the entire pending window the JSONL has zero signal; (c) the authoritative live signal is now the pane-scrape via `isPlanPending` wired above; (d) the scan is retained as belt-and-suspenders for the resolution-edge (it will re-emit `pending: null` after V2 flushes both the tool_use and matching tool_result on user resolution) and for backward compat with any older Claude Code sessions that might still write `ExitPlanMode` eagerly. Do NOT delete any scan code.
    6. Do NOT modify any WS message shape, frontend handler, or any other subsystem. The `case "plan_pending"` frontend handler (~line 643) and `PlanPendingBubble.tsx` stay untouched.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm run build:backend && npm run build</automated>
  </verify>
  <done>
    `claude-session-server.ts` imports and calls `isPlanPending` inside the existing setInterval. `planPendingLastSerialized` sentinel declared alongside `contextPctLastSerialized` and reset at BOTH mirror sites (~line 530 and ~line 730 — verify via grep). WS emission gated on serialized-value-changed, same pattern as `contextPct`. Legacy JSONL scan block unchanged in behavior with a 5-10 line deprecation comment inserted directly above it. `npm run build:backend` succeeds (REQUIRED — `npx tsc --noEmit` alone is insufficient per patch #154 learned preference; frontend tsconfig does not compile backend files the same way). `npm run build` succeeds. If the project runs it, `npm run lint` also passes. Git commit created with message `refactor(claude-session-server): wire pane-scrape into plan-pending emission` staging exactly `src/backend/claude-session/claude-session-server.ts`. NO push. NO docker build. NO docker compose up. NO container restart.
  </done>
</task>

</tasks>

<verification>
- Vitest: `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts` — all 6 cases green.
- Backend build: `npm run build:backend` — no TS errors. **This is REQUIRED**; `npx tsc --noEmit` alone is INSUFFICIENT (documented learned preference from patch #154 fixup — frontend tsconfig does not compile backend files the same way).
- Full build: `npm run build` — green.
- Lint (if project runs it): `npm run lint` — green.
- Grep sanity: `grep -n "planPendingLastSerialized\s*=" src/backend/claude-session/claude-session-server.ts` — count of assignments must match count of `contextPctLastSerialized\s*=` assignments (declaration + both reset sites + the in-callback update).
- Git log: exactly 2 new commits on `feat/tab-title-from-tmux`, in order: Commit A (`feat(plan-pending-parser): ...`) then Commit B (`refactor(claude-session-server): ...`).
</verification>

<success_criteria>
- Two new files exist: `plan-pending-parser.ts` (pure helper, zero imports) and `plan-pending-parser.test.ts` (6 cases, all green).
- `claude-session-server.ts` wires the helper into the existing setInterval pane-scrape alongside `parseContextPct`, gates emission on serialized-diff, resets `planPendingLastSerialized` at both mirror sites, and has a deprecation comment above the untouched legacy JSONL scan.
- `npm run build:backend` and `npm run build` both green.
- Exactly 2 atomic commits landed on `feat/tab-title-from-tmux` in the specified order.
- SHIP RULE HELD: no `git push`, no `docker build`, no `docker compose up`, no container restart. Ashley greenlights ship separately.
</success_criteria>

<output>
Two commits on `feat/tab-title-from-tmux`. No SUMMARY file required for a quick task. Return control to Tina for the identity-side bookkeeping (numbered entry in `~/.claude/identities/tina/skynet-patches.md`, bounty timeline update) and to Ashley for the ship word.
</output>
