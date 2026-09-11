# Phase 106: birth-flow rework Chunk 3 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-11
**Phase:** 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
**Areas discussed:** Wait-poll placement, Timeout + poll cadence

**Note:** Full shape context was locked upstream via `/build` → `/open` → `shape-birth-flow-supervisor-sole-spawner.md` (opened + greenlit 2026-09-11 same session). This discuss-phase pass was deliberately narrow — codebase-verification of the shape file's assumptions + the two remaining implementation decisions that couldn't be resolved at conceptual level.

---

## Verification pass (no user questions — codebase-side checks)

Confirmed the shape file's three technical assumptions against the codebase before opening the gray-area discussion:

- **Transcript-file signal exists as reusable helper.** `discoverIdentitySessionFile(conn, identityName)` at `src/backend/claude-session/discover-identity-session-file.ts` — matches the shape's description verbatim (mtime-newest JSONL under `~/.claude/projects/*/` whose first user-role line matches `/id <identityName>`). Already consumed by `fleet-status/ssh-poll-orchestrator.ts:904` and `database/routes/sessions.ts:14`. Reusable as-is; no new sensor needed.
- **Supervisor reconcile cadence pinned.** `CHECK_INTERVAL=15` at `substrate/scripts/agent-supervisor.sh:53`. Worst-case latency from Skynet's disk-write to transcript-file-appears ≈ 45-60s (15s tick + tmux launch + REPL up + 22s settle-train + /id load).
- **Auto-route mechanic already correct.** `AppShell.tsx:2236` `onCreateSession` handler already does `openTab(..., { targetTmuxSession, allowCreateTmux: false })` + `selectConversationDeferred(newTabId)`. Under the new shape, the party that made the tmux session differs (supervisor instead of Skynet) but the frontend attach-not-create semantics are identical. No wiring changes needed.

---

## Wait-poll placement

| Option | Description | Selected |
|--------|-------------|----------|
| A. Backend-inside-SSE | Birth SSE stream stays open through the wait. Backend does disk+mint, then loops polling the target box via SSH exec for the transcript file, emits one final SSE event when signal fires or timeout hits. Modal consumes one continuous stream from click to resolution. | ✓ |
| B. Frontend polls a new endpoint | Birth SSE ends at Skynet's own completion. Frontend then polls a new `GET /identities/:name/session-alive?hostId=X` every couple seconds until success/timeout. Adds a new endpoint; decouples "Skynet's job" from "wait for supervisor". | |

**User's choice:** A (backend-inside-SSE).
**Notes:** Presented with my lean toward A. Ashley agreed. Rationale: single wire contract is cleaner from the modal's perspective; the connection-hold time isn't a real concern given typical fleet density.

---

## Timeout + poll cadence numbers

| Option | Description | Selected |
|--------|-------------|----------|
| Poll every 2s, timeout 120s | Cadence matches fleet-status orchestrator default; timeout is 2× buffer over worst-case (~60s realistic ceiling). | ✓ |
| Alternative values | User specifies different numbers | |

**User's choice:** Agreed on proposed 2s / 120s.
**Notes:** No alternative proposed. Numbers pinned to constants at plan time for testability (`WAIT_FOR_SUPERVISOR_POLL_MS = 2000`, `WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000`).

---

## Claude's Discretion

Decisions where Ashley's earlier locked answers (from `/open`) fully covered scope, so no discuss-phase re-ask was needed:

- **Failure surface = one generic `window.alert("agent creation failed")`.** Confirmed in `/open` grill.
- **Failure classes not distinguished** (Skynet-side vs supervisor-wait timeout). Confirmed in `/open` grill.
- **Partial state left on disk on timeout, log the problem.** Confirmed in `/open` grill (Q1).
- **Retry semantics inherit existing collision behavior.** Confirmed in `/open` grill (Q2).
- **Spinner replaces Create button label; modal locked from click to resolution.** Confirmed in `/open` grill (Q3, Q4).
- **Shell-only branch of modal unchanged.** Confirmed in `/open` grill (Q5).
- **Chunk 4 dissolves** (per-step-checkmarks scope dead under this shape). Confirmed in `/open` grill (Q6).

Planner-level flexibility on:

- Exact code organization of the new wait loop (helper function vs inline).
- Constant definitions (`WAIT_FOR_SUPERVISOR_POLL_MS` / `WAIT_FOR_SUPERVISOR_TIMEOUT_MS` at file top vs inline).
- SSE keepalive frame cadence during the up-to-120s hold (verify at plan time whether the express middleware or the response object needs an explicit keepalive).
- Whether to add a new `type: "wait"` event kind to `BirthEvent` for backend log-forensics symmetry (versus routing wait-phase observability entirely through the structured logger).
- Whether to import a shared `sleep(ms)` helper or reuse the file-local one at `identity-birth-orchestrator.ts:331`.
- Exact log entry wording on timeout (recommend `databaseLogger.warn` with `operation: "identity_birth_supervisor_wait_timeout"`).

## Deferred Ideas

- **Chunk 4 dissolves under this shape.** Related bounty `newsessiondialog-ux-per-step-visible` should be marked done/dropped as part of closing this phase.
- **Chunk 2's workspace-path fallback becomes vestigial after this phase.** Do NOT remove in this phase — still needed by shell-only branch. If ever removed, would be a separate cleanup phase.
- **Clone-flow cleanup — should `identity-clone.ts` also stop calling `startHarnessOnIdentity`?** Same architectural question as this phase, but for clone. Would allow full deletion of `identity-harness-start.ts`. Out of scope for Chunk 3; separate phase if pursued.
- **Downstream deployment (T800 / Stacy) pull-through** — batched for after all 3 chunks land, per Ashley's direction.
- **Richer diagnostic surface for the failure log** (exposing it to the operator through some UI). Separate concern; own phase if pursued.
