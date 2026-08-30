# Phase 51: BG-agents panel — admit 2.1.150+ async Agent invocations via tool_result launch-ack

**Gathered:** 2026-08-20
**Status:** Ready for planning
**Source:** Pre-written by orchestrator (tabitha) from live-session diagnostic

<domain>
## Phase Boundary

**What this phase delivers:** The pretty-view BG-agents panel (the section above the composebox that lists currently-running sub-agent invocations) shows async `Agent{...}` calls issued by Claude Code v2.1.150+, which today are silently rejected by the parser's admission gate. Bug 1 of the existing bounty `claude-code-2-1-214-pretty-view-compat`. Ashley observed the failure live watching taylor's `gsd-executor` sub-agent, whose Task tool_use is in the parent JSONL but doesn't render in the panel; the executor's full conversation is in `subagents/agent-af330c389b8187098.jsonl` (a modern Claude Code storage-split that is out-of-scope for this phase).

**What this phase does NOT deliver:**
- Rendering sub-agent CONVERSATION content in pretty view (the `subagents/agent-*.jsonl` files) — that's a separate design call.
- Bug 2 of the same bounty (plan-pending bubble via `permission-mode` events) — separate phase.
- Any UI/CSS changes to the panel — the panel already exists and renders correctly; this is a pure backend-parser admission fix.
- Deploy — orchestrator handles deploy after executor returns tests-green.

</domain>

<decisions>
## Implementation Decisions

### Parser admission gate
- **Drop the sole-gate requirement of `input.run_in_background === true`** at the Agent tool_use branch (`claude-session-server.ts` ~L2506). Modern Claude Code writes `Agent` invocations with input keys `[description, prompt, subagent_type]` — no `run_in_background`.
- **Add a second admission path via the tool_result launch-ack.** The parser already reads `toolUseResult.isAsync === true` at ~L2559 as a skip-guard (so an async-launch-ack doesn't remove the entry). Reuse that signal to ADMIT: on the async-launch-ack, promote the tool_use into `backgroundedAgents`.
- **Preserve backward compat with the legacy shape.** If `input.run_in_background === true` (older Claude Code, or a future harness that reintroduces the field), admit at tool_use time as before. Both paths coexist — belt-and-suspenders, not either/or.
- **Scratch map for late admission.** Since the tool_use appears one line before the tool_result, maintain a scratch map keyed by `tool_use_id` capturing `{subagent_type, description, startedAt}` for every `Agent` tool_use seen. On tool_result-async-ack, look up the scratch entry and move it to `backgroundedAgents`. On tool_result-non-async (a sync completion), drop the scratch entry silently — it was a synchronous invocation and never was a "backgrounded" agent.

### Bash{run_in_background:true} branch
- **Verify empirically whether Bash needs the same treatment.** The parser's Bash branch at ~L2529 has the same shape as the Agent branch. If Claude Code v2.1.150+ also moved `Bash{run_in_background:true}` to an async-launch-ack signal, the same admission fix applies to Bash. Verification: grep a live JSONL from any 2.1.150+ session for a background Bash tool_use and inspect the input + its matching tool_result. If Bash still uses `run_in_background:true` in input, leave the Bash branch untouched.
- **If Bash also moved shape:** apply the same fix pattern to the Bash branch, using its own scratch map (or a shared map keyed by `{kind: "agent" | "bash", tool_use_id}`).

### Ordering & idempotence
- **Scratch map is process-local** to the correlator's tail loop, same as `backgroundedAgents`. No persistence.
- **`-n +1` replay must converge correctly.** The tail's replay-from-beginning semantics already handle backgrounded_agents converging (initial `lastSerialized = "[]"` matches empty-list stringification so no spurious empty emit). The scratch-map add is idempotent on re-seeing the same tool_use_id (last-write-wins is fine); the promote-and-clear on ack is idempotent (double-promote = no-op; double-clear = no-op).
- **Removal semantics unchanged.** Real completion of a promoted agent = `backgroundedAgents.delete(tool_use_id)` on the completion tool_result (which is what the existing branch already does when `isAsyncAck` is false).

### Test coverage
- Add parser fixtures for the new shape:
  - Fixture 1: `Agent` tool_use with input keys `[description, prompt, subagent_type]` (no `run_in_background`) → matching tool_result with `toolUseResult.isAsync === true` + `status: "async_launched"` → assert `backgroundedAgents` gains the entry.
  - Fixture 2: same tool_use → completion tool_result (no isAsync, real content) → assert scratch entry is dropped and NOTHING is emitted into backgroundedAgents (synchronous Agent case).
  - Fixture 3: legacy shape — `Agent` tool_use with `input.run_in_background === true` → assert immediate admission (backward compat).
  - Fixture 4: async-launched Agent → later, real completion tool_result → assert `backgroundedAgents` gains then loses the entry, and the emitted stream matches expectation.
- **Bash coverage:** contingent on verification. If Bash also moved shape, mirror the four fixtures for the Bash branch.

### Scope discipline
- Executor scope stops at code + commit + tests green. No `git push`, no `docker build`, no coord-room. Orchestrator (tabitha) picks up deploy.
- No `git worktree` (fleet rule). Executor runs sequentially on the main tree at `~/skynet-tabitha`.

### Claude's Discretion
- Exact scratch-map data structure (Map, Record, plain object) — Whatever fits the existing correlator idiom.
- Whether the scratch map lives in the same closure as `backgroundedAgents` or a sibling closure — Wherever cleanest.
- Fixture naming / file placement — Whatever the existing parser test conventions dictate.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The parser code being changed
- `src/backend/claude-session/claude-session-server.ts` — the module. Function of interest: the `backgrounded_agents` correlator around L2470-2600. Existing skip-guard at L2559 (`isAsyncAck` from `toolUseResult.isAsync`).

### Existing parser test scaffolding
- `src/backend/claude-session/claude-session-server.malformed-eventid.test.ts` — established fixture-line pattern.
- `src/backend/claude-session/session-file-parser.test.ts` — shows sidechain-line handling patterns.
- Other `claude-session-server.*.test.ts` files in the same directory — pick whichever conventions are already in use.

### Bounty context
- `~/.claude/roles/box-maintainer/bounties/claude-code-2-1-214-pretty-view-compat/bounty.json` — the parked bounty documenting both Bug 1 (this phase) and Bug 2 (separate phase). Contains vicky's July 2026 diagnosis and Ashley's original downgrade-instead-of-fix decision.

### Live diagnostic evidence
- Taylor's parent JSONL: `~/.claude/projects/-home-ubuntu-skynet-taylor/c054cef9-c251-4d00-a460-8e90dbead931.jsonl` — contains `toolu_01C3yz4A5NV4Aa` (in-flight `gsd-executor` Agent tool_use) with input keys `[description, prompt, subagent_type]`, no `run_in_background`. Parent's session version is `2.1.150` per its per-line `version` field.
- Sub-agent's own JSONL: `~/.claude/projects/-home-ubuntu-skynet-taylor/c054cef9-c251-4d00-a460-8e90dbead931/subagents/agent-af330c389b8187098.jsonl` — full sub-agent conversation, out-of-scope for this phase but confirms the storage-split behavior.

### Existing patch history
- Patches #61, #63, #66 in `~/.claude/roles/box-maintainer/skynet-patches.md` — earlier iterations of the BG-agents panel plumbing. Patch #66 introduced the `isAsyncAck` skip-guard at L2559. This phase will land as a new patch number claimed at ship time.

</canonical_refs>

<specifics>
## Specific Ideas

### Verification of Bash branch (do this FIRST during research)

Grep any live 2.1.150+ session JSONL for a background-Bash pattern:
```bash
for f in ~/.claude/projects/*/*.jsonl; do
  jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash" and .input.run_in_background==true)' "$f" 2>/dev/null | head -1
done
```
Then find the matching tool_result (by tool_use_id) and inspect its `toolUseResult.isAsync` field. Determines whether Bash needs the same fix.

### Fixture shape reference (from parent JSONL)

Real 2.1.150 Agent tool_use — copy this shape into the test fixture:
```json
{"type":"tool_use","id":"toolu_01C3yz4A5NV4AamxHQRZH7DH","name":"Agent","input":{"description":"Apply code-review fixes as atomic commits","subagent_type":"gsd-executor","prompt":"..."}}
```
Matching async-launch-ack tool_result — inspect a completed one in the same JSONL to lift the exact shape. Look for `toolUseResult.isAsync === true` + `status: "async_launched"`.

### Guard against false-positive sync-completion drop

If a real async completion happens to arrive without `isAsync:true` (edge case — the launch-ack might race the actual completion in a very fast sync-adjacent path), the scratch-drop path would incorrectly discard a real backgrounded entry. Mitigation: only drop scratch when the tool_result arrives within a very short window (~500ms) of the tool_use. In practice, async-launch-acks fire within ~100ms; real completions come minutes later. If in doubt during planning: keep scratch entries indefinitely once seen; only drop on explicit signals (the async-ack promotes; a completion for an entry that WAS promoted removes). Never-promoted scratch entries simply linger harmlessly.

</specifics>

<deferred>
## Deferred Ideas

- **Bug 2: Plan-pending bubble via `permission-mode` events** — separate phase; bounty documents the shape (parser needs to watch for `{type:"permission-mode", permissionMode:"plan"}` and drive the plan-pending bubble off that instead of a nonexistent `ExitPlanMode` tool_use).
- **Rendering sub-agent CONVERSATION content in pretty view** — Ashley may want this later; requires reading `subagents/agent-*.jsonl` files, wiring them either inline under the parent Task tool_use bubble, as drill-down, or as their own conversation-list rows. Distinct code path from the panel admission fix. Not in this phase.
- **Bump Claude Code version on this box** — probably worth an eventual audit, but decoupled from this fix.

</deferred>

<scope_fence>
## Scope Fence

- **In:** `src/backend/claude-session/claude-session-server.ts` (the backgrounded_agents correlator); one or more new fixture-based tests in `src/backend/claude-session/*.test.ts`.
- **Out:** frontend, UI-SPEC, CSS, panel rendering, sub-agent conversation content, plan-pending bubble, Skynet frontend surfaces, any coord-room automation.
- **No new deps.** No nginx changes. No docker changes. No backend endpoint additions.

</scope_fence>

---

*Phase: 51-bg-agents-panel-admit-2-1-150-async-agent-invocations-via-to*
*Context gathered: 2026-08-20 pre-written by tabitha orchestrator from live-session diagnostic*
