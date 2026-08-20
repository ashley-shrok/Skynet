# Phase 51 Research — BG-agents panel admission for 2.1.150+ async Agents

**Written:** 2026-08-20 by tabitha orchestrator (pre-written from live diagnostic)
**Session version verified against:** Claude Code v2.1.150 (taylor's `c054cef9-...jsonl` + tabitha's own `3e13353a-...jsonl`)

## Executive Summary

The parser's `backgrounded_agents` correlator at `src/backend/claude-session/claude-session-server.ts` ~L2506 gates admission of async `Agent` invocations on `input.run_in_background === true`. Claude Code v2.1.150+ dropped that field from `Agent` tool_use payloads and moved the async signal to the tool_result launch-ack (`toolUseResult.isAsync === true`). The parser already reads that signal at ~L2559 as a skip-guard (to prevent premature removal on ack) but never uses it to admit. Fix: add a second admission path via the ack, keyed through a small scratch map that captures Agent tool_use metadata for late promotion.

**Empirical finding:** `Bash{run_in_background:true}` still uses the legacy input-field shape on v2.1.150. Only `Agent` moved. The Bash branch at ~L2529 does NOT need the fix.

## Diagnostic Evidence

### Agent shape on v2.1.150 (broken)

Live from taylor's session (`~/.claude/projects/-home-ubuntu-skynet-taylor/c054cef9-c251-4d00-a460-8e90dbead931.jsonl`, session `version: 2.1.150`):

**Agent tool_use:**
```json
{
  "type": "tool_use",
  "id": "toolu_01C3yz4A5NV4AamxHQRZH7DH",
  "name": "Agent",
  "input": {
    "description": "Apply code-review fixes as atomic commits",
    "subagent_type": "gsd-executor",
    "prompt": "..."
  }
}
```

**Notice:** input keys are exactly `[description, prompt, subagent_type]` — NO `run_in_background`.

**Parent NOT blocked:** After this tool_use, the parent JSONL continues to emit `queue-operation` events, confirming the Agent is running async (else the parent would be waiting synchronously on the tool_result).

**Existing parser gate (rejects this shape):**
```typescript
if (
  b?.type === "tool_use" &&
  b?.name === "Agent" &&
  b?.input?.run_in_background === true &&  // <-- gate: FAILS on 2.1.150+ Agent
  typeof b?.id === "string"
) {
  backgroundedAgents.set(b.id, { ... });
}
```

### Bash shape on v2.1.150 (still legacy — no fix needed)

Live from tabitha's own session (`~/.claude/projects/-home-ubuntu-skynet-tabitha/3e13353a-....jsonl`, session `version: 2.1.150`):

**Bash tool_use:**
```json
{
  "type": "tool_use",
  "id": "toolu_01F2vX2zfrFf7Yb8T73mGB9H",
  "name": "Bash",
  "input": { "run_in_background": true, "description": "Install node_modules for the fresh clone" }
}
```

**Matching tool_result's toolUseResult:**
```json
{
  "stdout": "",
  "stderr": "",
  "interrupted": false,
  "isImage": false,
  "noOutputExpected": false,
  "backgroundTaskId": "bh24wlltm"
}
```

**Notice:** Bash input STILL has `run_in_background: true`. The tool_result carries `backgroundTaskId` (a signal the harness uses for output-file wiring), but NO `isAsync` field. The existing Bash gate at ~L2529 continues to work correctly on v2.1.150. **Do not touch the Bash branch.**

### Async-ack signal (already parsed, unused for admission)

At `claude-session-server.ts` ~L2559 the parser already extracts:
```typescript
const isAsyncAck =
  (obj as { toolUseResult?: { isAsync?: boolean } })?.toolUseResult
    ?.isAsync === true;
if (!isAsyncAck) {
  // remove entries whose tool_use_id matches
}
```

Half the work is done. This phase reuses this signal in an ADD direction.

## Fix Shape (recommended)

### 1. Introduce scratch map for late-admission Agent metadata

Alongside `backgroundedAgents`, add a scratch map:
```typescript
const pendingAgentAdmission = new Map<string, {
  toolUseId: string;
  subagentType: string;
  description: string;
  startedAt: number;
}>();
```

Scope: same closure as `backgroundedAgents`. Process-local. No persistence.

### 2. Admit every Agent tool_use into scratch (drop the `run_in_background === true` restriction on the START gate)

Change the L2506-ish block:

```typescript
// BEFORE:
if (
  b?.type === "tool_use" &&
  b?.name === "Agent" &&
  b?.input?.run_in_background === true &&
  typeof b?.id === "string"
) {
  backgroundedAgents.set(b.id, { toolUseId, subagentType, description, startedAt });
}

// AFTER:
if (
  b?.type === "tool_use" &&
  b?.name === "Agent" &&
  typeof b?.id === "string"
) {
  const info = { toolUseId: b.id, subagentType, description, startedAt };

  if (b?.input?.run_in_background === true) {
    // Legacy shape (older Claude Code, or any harness that reintroduces the field):
    // admit directly, same as today. Preserves backward compat.
    backgroundedAgents.set(b.id, info);
  } else {
    // Modern shape (2.1.150+): stash for late admission on the async-launch-ack.
    // A synchronous Agent will never receive the ack — its scratch entry stays
    // until removed on completion OR simply lingers harmlessly (see §4).
    pendingAgentAdmission.set(b.id, info);
  }
}
```

### 3. Promote scratch entries on the async-launch-ack

Extend the L2559-ish `isAsyncAck` branch. Currently it uses the ack to SKIP removal; now also use it to PROMOTE:

```typescript
if (isAsyncAck) {
  // Iterate the tool_result blocks (this line's content) — for each one whose
  // tool_use_id is in pendingAgentAdmission, move to backgroundedAgents.
  for (const block of content as unknown[]) {
    const b = block as { type?: string; tool_use_id?: string };
    if (b?.type === "tool_result" && typeof b?.tool_use_id === "string") {
      const info = pendingAgentAdmission.get(b.tool_use_id);
      if (info) {
        backgroundedAgents.set(b.tool_use_id, info);
        pendingAgentAdmission.delete(b.tool_use_id);
      }
    }
  }
  // Existing behavior preserved: do NOT remove from backgroundedAgents on the ack.
} else {
  // Existing removal branch: remove backgroundedAgents entries for the completed tool_use_id.
  // ALSO: drop any lingering scratch entry — this was a synchronous Agent call
  // whose completion arrived without an isAsync ack.
  for (const block of content as unknown[]) {
    const b = block as { type?: string; tool_use_id?: string };
    if (b?.type === "tool_result" && typeof b?.tool_use_id === "string") {
      backgroundedAgents.delete(b.tool_use_id);
      pendingAgentAdmission.delete(b.tool_use_id);
    }
  }
}
```

### 4. Idempotence & replay safety

- **`-n +1` replay:** Every replay sees the same lines in the same order. Scratch adds are idempotent (`Map.set` last-write-wins is fine; the value is stable per tool_use_id). Promote-and-clear is idempotent (`Map.delete` on already-absent is a no-op). No spurious emits.
- **`lastSerialized` sentinel:** Unchanged. Empty-list stringification still matches initial state; first non-empty emit is still the first mutation.
- **Sync Agent invocations:** stash → immediate completion tool_result → scratch is dropped in the else branch. Never enter `backgroundedAgents`. No emit noise.
- **Async Agent invocations:** stash → async-ack promotes → completion drops. One add-emit, one remove-emit. Same lifecycle as today for legacy-flag async agents.
- **Lingering scratch entries in edge cases:** if a sync Agent invocation's completion tool_result never arrives (parent crashed mid-turn), the scratch entry stays until the tail restarts and re-reads. Harmless — scratch is not emitted, only tracked.

## Test Plan (specifics for the planner)

### Fixture-based unit tests

Add to `src/backend/claude-session/claude-session-server.*.test.ts` (planner picks the right existing file). Four fixtures:

**Fixture A — Async Agent, modern shape (the main fix):**
1. Line 1: `type:"assistant"`, message.content contains `Agent` tool_use with input `{description, prompt, subagent_type}` (no run_in_background), id `toolu_A1`.
2. Line 2: `type:"user"`, message.content contains `tool_result` with `tool_use_id: "toolu_A1"`, and the enclosing turn has `toolUseResult: {isAsync: true, status: "async_launched", ...}`.
3. **Assert:** `backgroundedAgents` contains `toolu_A1` with correct subagentType + description.

**Fixture B — Sync Agent, modern shape:**
1. Line 1: same Agent tool_use as A, id `toolu_A2`.
2. Line 2: `type:"user"`, `tool_result` for `toolu_A2` with a real content payload and NO `isAsync` on the toolUseResult.
3. **Assert:** `backgroundedAgents` does NOT contain `toolu_A2` (was sync, never promoted; scratch dropped).

**Fixture C — Legacy shape (backward compat):**
1. Line 1: `Agent` tool_use with `input.run_in_background === true`, id `toolu_A3`.
2. **Assert:** `backgroundedAgents` contains `toolu_A3` immediately at tool_use time (legacy fast-path).
3. Line 2: `tool_result` for `toolu_A3` with `toolUseResult.isAsync === true` (ack).
4. **Assert:** `backgroundedAgents` still contains `toolu_A3` (skip-guard preserved).
5. Line 3: `tool_result` for `toolu_A3` with completion content, no isAsync.
6. **Assert:** `backgroundedAgents` no longer contains `toolu_A3`.

**Fixture D — Full lifecycle, modern shape:**
1. Line 1: modern Agent tool_use, id `toolu_A4`.
2. Line 2: async-launch-ack tool_result.
3. Line 3: real completion tool_result for `toolu_A4` (much later).
4. **Assert:** intermediate snapshot after line 2 shows `toolu_A4` in `backgroundedAgents`; final snapshot after line 3 shows it removed.

### Copy real fixture lines from taylor's live JSONL

Rather than fabricate the shape, copy the exact tool_use JSON from `~/.claude/projects/-home-ubuntu-skynet-taylor/c054cef9-c251-4d00-a460-8e90dbead931.jsonl` (grep for `toolu_01C3yz4A5NV4AamxHQRZH7DH`) and lift a completed async-ack tool_result from the same file (grep for a tool_result whose parent turn has `toolUseResult.isAsync === true`). Real bytes eliminate the risk of a fictitious fixture that doesn't match reality.

### No Bash tests needed

Because the empirical finding says Bash still uses the legacy shape, no new Bash tests are required. If a future Claude Code version does move Bash, the same pattern applies — but that's a future phase.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Modern Claude Code introduces a THIRD shape (e.g. neither `run_in_background` in input nor `isAsync` on ack) | Low | Fixture-based tests catch drift; when it happens, add a third admission path. |
| An async-ack arrives BEFORE the tool_use line in some edge case (out-of-order tail) | Very low — JSONL is written in order | Promote would find no scratch entry and be a no-op; the tool_use line will later create the scratch entry and it will simply linger. Non-fatal; would need a second-mechanism check to catch. Defer unless observed. |
| Scratch map grows unbounded if many sync Agents fire and none get their completions written | Very low | Real Claude Code writes tool_results promptly; if this happens it's a symptom of a bigger problem. Defer. |
| Removing the `run_in_background === true` requirement on the START gate breaks something the panel depends on | None identified | The panel emits based on `backgroundedAgents` map changes, not on the raw gate. Scratch entries never enter that map. |
| The verification of Bash-branch-unchanged is stale (a NEWER 2.1.15x moves Bash too) | Low | Test fixtures + the empirical grep in this doc are the record. If a future audit shows Bash also moved, mirror the fix. |

## Waves / Task Sizing

One plan, one wave. Sequential.

- **Plan 51-01 — Parser admission via async-launch-ack + fixtures.** Single plan. Order of tasks: (1) RED tests (four fixtures) → (2) implement scratch map + updated gates → (3) GREEN tests → (4) `npx vitest run` full-suite green + `npm run build:backend` + `npm run build`. No frontend touches (backend-only phase).

## Not-in-scope reminders for planner

- No `git push`, no `docker build`, no `docker compose up`, no coord-room posts inside the executor. Orchestrator handles deploy after executor returns tests-green.
- No `git worktree` (fleet rule).
- No modifications to the Bash{run_in_background:true} branch (verified unchanged on 2.1.150+).
- No frontend touches. No CSS. No nginx. No new endpoints.
- No changes to the `backgroundedShells` correlator (Bash-adjacent, still works).

## Verification tie-back

Post-deploy, the smoking-gun is: watch taylor's PrettyView (or any 2.1.150+ session that spawns an async Agent) and confirm the BG-agents panel now shows the running sub-agent. Server-side sanity: hit the WS `pretty-view` events and confirm `{type: "backgrounded_agents", agents: [...]}` frames now include Agent invocations whose parent JSONL tool_use lacks `run_in_background`.

---

*Research complete: 2026-08-20 by tabitha orchestrator*
