# Phase 106: birth-flow rework Chunk 3 — retire Skynet tmux+claude launch, supervisor becomes sole spawner — Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Chunk 3 of a 3-chunk birth-flow rework arc. Retires Skynet backend birth's tmux new-session (part of current Step 2) + full harness bootstrap (current Step 3 — trust-flag pre-write, claude launch, 7-Enter settle train, `/id <name>` dispatch). Agent-supervisor becomes the sole party responsible for tmux + claude-process lifecycle on every managed box — it already does this work on its 15s reconcile tick (Chunk 1, `5f6efd29`, retired MODE=A) whenever a new identity appears on disk that has no session.

**What Skynet's birth still does after this phase:** collision probe → write identity folder tree + files + avatar sibling (current Step 2's `mkdir -p ... && touch handoff.md` + Step 2.5 identity-file pre-write) → mint Matrix relay account (current Steps 6, 7, 8 unchanged) → wait for the supervisor to bring the agent alive → close modal + auto-route (success) OR log + JS alert (timeout).

**What Skynet's birth stops doing:** the `tmux new-session -d -s <name> -c <path> -x 220 -y 50` portion of Step 2; the entire Step 3 (call to `startHarnessOnIdentity`); the synthetic step:4/step:5 emit-only events kept for frontend-checklist parity.

**Frontend surface change:** `NewSessionDialog.tsx` identity-mode branch's 5-step `BirthProgress` checklist collapses into a single spinner that replaces the Create button's text label. Fields disabled + close disabled during the wait. Success closes the modal + auto-routes into the new agent's chat surface via the existing `onCreateSession` → AppShell `openTab(host, "terminal", ..., { targetTmuxSession, allowCreateTmux: false })` → `selectConversationDeferred` chain (already correct — no wiring changes). Timeout closes the modal + fires `window.alert("agent creation failed")`.

**Shell-only branch of `NewSessionDialog` is untouched** in every respect (fields, submit, close-on-submit) — this phase only reshapes the identity-mode branch.

</domain>

<decisions>
## Implementation Decisions

### Sole-spawner architecture
- **D-01:** Retire the tmux new-session invocation from `identity-birth-orchestrator.ts` Step 2. Retain Step 2's remaining work (`mkdir -p` of `wakeups/` + `workspace/`, `touch handoff.md`, Step 2.5 identity-file SFTP pre-write, Step 2.5 avatar sibling SFTP pre-write). The `-x 220 -y 50` terminal sizing responsibility passes to agent-supervisor (`substrate/scripts/agent-supervisor.sh` already uses `-x 220 -y 50` in its FRESH block — nothing to add there).
- **D-02:** Retire the entire Step 3 block (`runStep(3, () => startHarnessOnIdentity(...))` at `identity-birth-orchestrator.ts:1269-1275`) AND the synthetic step:4/step:5 emit calls (`identity-birth-orchestrator.ts:1278-1281`). No more per-step launch beats on the wire.
- **D-03:** `startHarnessOnIdentity` (`identity-harness-start.ts`) stays in the module — `identity-clone.ts:632` still calls it. Only remove the import in `identity-birth-orchestrator.ts:27` and its Step 3 call site. Clone flow cleanup is out of scope for this phase.
- **D-04:** `path` field stays on the birth wire and in `BirthOptions`. Chunk 2's workspace-path fallback substitution at `identity-birth.ts` becomes vestigial (agent-supervisor derives its own launch cwd from `~/fleet/identities/<name>/workspace/`) but is not removed in this phase — path field is still needed by the shell-only branch of the same modal (D-04 non-removal is deliberate, matches the "tempting but no" clause in shape §Scope edges).

### Wait-for-supervisor signal + poll
- **D-05:** Signal for "agent is alive on the box" = the transcript-file signal already used by fleet-status. Reuse `discoverIdentitySessionFile(conn, identityName)` from `src/backend/claude-session/discover-identity-session-file.ts` — mtime-newest JSONL under `~/.claude/projects/*/` whose first user-role line matches `/id <identityName>`. Same helper `sessions.ts` and `ssh-poll-orchestrator.ts` already consume. Non-null return = signal fired.
- **D-06:** Poll placement: **backend-inside-SSE (Option A from discussion).** The `birthIdentity` orchestrator's SSE stream stays open through the wait. After the Step 6/7/8 mint block completes, the orchestrator enters a wait loop that runs `discoverIdentitySessionFile` on the same SSH connection every 2 seconds, up to 120 seconds. First non-null result → emit success event + close stream. Cap hit → emit timeout event + close stream. No new HTTP endpoint.
- **D-07:** Poll cadence = **2 seconds** (matches fleet-status orchestrator default granularity).
- **D-08:** Timeout = **120 seconds** (2 minutes — 2× buffer over worst-case: 15s supervisor tick + ~30-40s agent boot chain of tmux-launch + REPL-up + 7-Enter settle + `/id` load = ~45-60s realistic ceiling).
- **D-09:** SSE connection kept alive during the wait via the existing `keepAliveInterval` mechanism in `identity-birth.ts` (if not already present, add one — need to verify at plan time). Backend SSE writes need to keep the connection open; the wait loop should not block the event loop or starve other SSH work — the poll runs sequential `await execCommand`s, no concurrency.

### Wire contract (new SSE event shape)
- **D-10:** Replace the current step-based `BirthEvent` union with a simpler wire. The current numbered-step contract (`{ type: "step", n: 1|2|3|4|5|6|7|8, phase: "started"|"completed"|"failed", reason?: string }`) is retained for backend log-forensics granularity, but the frontend consumes only the terminal `ended` event under the new shape. The frontend spinner doesn't inspect intermediate step events — the modal shows a spinner from click until `ended` arrives, regardless of which step emitted last.
- **D-11:** `ended` event grows a new `reason` string on the failure path so backend can distinguish (in logs) whether failure was Skynet-side (Step 1/2/6/7/8 error) vs supervisor-wait timeout. Frontend ignores the reason string entirely and always shows the same generic alert — the string exists for the log / for future debugging surfaces, not for UX branching. Concrete shape: `{ type: "ended", ok: false, failedStep?: number, reason?: string }` on failure; `{ type: "ended", ok: true, identityId, sessionName }` on success (unchanged from today).
- **D-12:** Intermediate step events stay on the wire during the mint block (step:1, step:2, step:6, step:7, step:8) purely as backend log-forensic breadcrumbs — the frontend's SSE consumer just discards them under the new modal. This preserves per-step failure attribution in server logs for post-mortem without requiring frontend-side handling.

### Frontend modal shape
- **D-13:** Delete the `BirthProgress` inline component (`NewSessionDialog.tsx:186-301`), `BIRTH_STEP_LABELS` (`:190-196`), `BIRTH_STEP_BLURBS` (`:201-207`), `BirthStepState` type (`:211-215`), `INITIAL_BIRTH_PROGRESS` (`:217-223`), `birthProgress` + `birthFailedStep` state (`:424` + related), `resetBirthProgress` (`:456-458`), `anyStepActive` / `showBirthProgress` derivations (`:865-866`), and the `<BirthProgress .../>` render at `:1274-1281`.
- **D-14:** Replace the Create button's label with a spinner icon (`Loader2` from lucide-react, already imported at `NewSessionDialog.tsx`) while `birthing === true`. When `birthing === false`, render normal "Create" text.
- **D-15:** During `birthing === true`: form fields disabled (existing `formDisabled` derivation adapts — remove the `birthFailedStep !== null` clause since there is no failure-persist state anymore), and the modal's close affordance disabled (the dialog's `onOpenChange` handler must no-op while `birthing`). Modal is fully locked from click to resolution.
- **D-16:** On success: existing `onCreate({ host, sessionName, path, identityMode: true, name })` chain fires, then `onClose()`. Auto-route into pretty-view for the new identity is already handled by `AppShell.tsx:2236` `onCreateSession` handler's `openTab(...)` + `selectConversationDeferred(newTabId)`. No modification needed to the AppShell handler.
- **D-17:** On failure (any type — Skynet-side or supervisor-wait timeout): call `window.alert("agent creation failed")` (browser blocking alert per shape §Failure surface), then `onClose()`. No fields preserved; user re-opens the modal from scratch. Retry semantics inherit existing name-collision behavior (if the failed attempt left an identity on disk, next attempt with same name gets "already in use" via existing `skynetCollision`/`hostCollision` checks).
- **D-18:** `refreshIdentities()` call currently at `NewSessionDialog.tsx:783` (best-effort refresh so the just-born identity is in the identities store before AppShell's `openTab` resolves it into pretty-view routing) STAYS — under the new shape it still needs to run between the SSE stream closing with success and `onCreate` firing.

### Failure blurb cleanup
- **D-19:** The five per-step failure blurbs in `BIRTH_STEP_BLURBS` (`NewSessionDialog.tsx:201-207`) telling users to `ssh <host> tmux attach -t <name> ...` and continue by hand are useless under the new flow (Skynet no longer runs those steps, so there is no "step 3 attach and continue"). Delete all five strings when deleting `BirthProgress`. The generic alert IS the entire failure surface.

### Tests
- **D-20:** Backend tests to update:
  - `identity-birth-orchestrator.test.ts` — all step:3/step:4/step:5 assertions (present today for the harness-launch beats) drop out. Add new tests for the wait-for-transcript poll: (a) success case where mock `discoverIdentitySessionFile` returns non-null on Nth poll; (b) timeout case where it returns null throughout; (c) SSH-error-during-poll case; (d) verify the mint block still emits step:6/step:7/step:8 events for log-forensic purposes.
  - `identity-birth-orchestrator.role-frontmatter.test.ts` — remove any assertions about step:3+ events; the Step 2.5 identity-file body assertions stay.
  - `identity-birth-orchestrator.mxid-derivation.test.ts` — remove any assertions about step:3+ events; the Step 6 MXID derivation assertions stay.
  - `identity-birth.test.ts` — SSE endpoint stream-shape test needs the new event shape (no step:3/4/5, new ended.reason field on failure).
  - `identity-harness-start.test.ts` — UNCHANGED (helper is still called by clone).
- **D-21:** Frontend tests to update:
  - `NewSessionDialog.test.tsx` — remove `BirthProgress`-rendering assertions; add spinner-in-button + close-disabled-during-birthing + `window.alert`-on-failure assertions.
  - `NewSessionDialog.chain.test.tsx` — verify birth+auto-route chain still fires after the ended:ok event.
  - `NewSessionDialog.role-dropdown.test.tsx` — no change expected (unrelated axis).
  - `NewSessionDialog.task-input.test.tsx` — no change expected (unrelated axis).

### Container-mutation coordination
- **D-22:** Deploy motion follows the standing role rule (container mutations serialize across identities). This phase's deploy will require: coord-room BEFORE post on `!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net` announcing "starting deploy on Phase 106 birth-flow-supervisor-sole-spawner, HEAD <sha>, hold if you're mid-container-work"; `git pull --rebase origin feat/tab-title-from-tmux` before push; full test suite gate (`npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` with `SKYNET_TEST_CREDS`); AFTER post on ship. Executor's remit STOPS at code + commit + scoped tests green — orchestrator (tina in-session) handles push + build + recreate + verify.

### Claude's Discretion
- Exact code organization of the new wait loop inside `birthIdentity` (helper function vs inline inside a runStep) — planner's call, both are viable.
- Whether to add a new `WAIT_FOR_SUPERVISOR_POLL_MS = 2000` / `WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000` constant pair at the top of `identity-birth-orchestrator.ts` (matches existing constants pattern) or inline them — planner's call, prefer named constants for testability.
- SSE keepalive frame cadence — verify at plan-time whether the express middleware or the response object needs an explicit keepalive during the up-to-120s hold; if so, add a periodic comment-frame emit every ~30s during the wait.
- Whether to import a shared `sleep(ms)` helper or reuse the file-local one at `identity-birth-orchestrator.ts:331`.
- The precise wording of the log entry on timeout (recommend structured log via `databaseLogger.warn` with `operation: "identity_birth_supervisor_wait_timeout"` per existing operation-key convention at L820-838).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape + prior chunks
- `.planning/shapes/shape-birth-flow-supervisor-sole-spawner.md` — LOCKED shape file for this phase. Contains the full What/Shape/Philosophy/Prior-context/Failure-modes/Scope-edges/Vehicle-notes. Every decision above traces back to this file.
- `~/fleet/roles/box-maintainer/bounties/birth-flow-supervisor-sole-spawner/bounty.json` — bounty record with arc premise, chunk 1+2 commit refs, todos.
- Git log: `5f6efd29` (Chunk 1 — supervisor MODE=A retired), `6cdff0ab` (Chunk 2 — identity-birth path fallback to `~/fleet/identities/<name>/workspace/`).

### Backend files this phase modifies
- `src/backend/database/routes/identity-birth-orchestrator.ts` — Steps 2 tmux + Step 3 harness bootstrap retired; new wait-for-supervisor poll block added between mint (Steps 6/7/8) and `ended:ok`.
- `src/backend/database/routes/identity-harness-start.ts` — UNCHANGED (still used by clone flow at `identity-clone.ts:632`).
- `src/backend/database/routes/identity-birth.ts` — SSE endpoint route; may need keepalive verification for the 120s hold.

### Frontend files this phase modifies
- `src/ui/sidebar/NewSessionDialog.tsx` — `BirthProgress` inline component + labels + blurbs deleted; spinner-in-button + close-disabled + alert-on-failure added.

### Reusable existing code
- `src/backend/claude-session/discover-identity-session-file.ts` — `discoverIdentitySessionFile(conn, identityName)` is the transcript-file signal source of truth. Same shape used by `fleet-status/ssh-poll-orchestrator.ts:904` via `discoverIdentityJsonlPathViaChannel` (SSH-channel adapter — reference for adapter pattern if needed) and by `src/backend/database/routes/sessions.ts:14` for dormant-side derivation.
- `src/backend/utils/logger.ts` — `databaseLogger` for structured warn log on timeout.

### Substrate reference
- `substrate/scripts/agent-supervisor.sh` §FRESH block — the party that will now be sole spawner. Reconcile cadence `CHECK_INTERVAL=15` at `:53`; uses `tmux new-session -d -s <name> -c <workdir> -x 220 -y 50`.

### Standing role rules
- `~/fleet/roles/box-maintainer/box-maintainer.md` § Standing directives — container-mutation serialize rule, executor-doesn't-deploy rule, test-discipline scoped-during-dev / full-suite-only-at-ship rule.

### Tests likely-to-touch
- Backend: `identity-birth-orchestrator.test.ts`, `identity-birth-orchestrator.role-frontmatter.test.ts`, `identity-birth-orchestrator.mxid-derivation.test.ts`, `identity-birth.test.ts`.
- Frontend: `NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`discoverIdentitySessionFile`** at `src/backend/claude-session/discover-identity-session-file.ts` — the exact sensor Ashley named for "the agent is alive." Takes an SSH connection + identity name, returns the mtime-newest JSONL path under `~/.claude/projects/*/` whose first user-role line matches `/id <name>`, or null. Reusable as-is for the wait poll. Executes as a single SSH exec producing a well-formed stdout parseable via `parseDiscoveryStdout`. Uses `find -maxdepth 2 -type f -name '*.jsonl' -printf '%T@ %p\n' | sort -rn | while read; do head -c 4096 | grep '/id <name>'...` — hard-coded to look under the exec-user's `~/.claude/projects/` (correct — that's where the supervisor-launched claude writes).
- **`Loader2` icon from lucide-react** — already imported in `NewSessionDialog.tsx`, used inside the existing `BirthProgress` component. Available for the new spinner-in-button without a new import.
- **`AppShell.tsx:2236` `onCreateSession` handler** — auto-route mechanic already correct (`openTab(..., { targetTmuxSession: sessionName, allowCreateTmux: false })` + `selectConversationDeferred(newTabId)`). New shape doesn't touch this file.
- **`databaseLogger.warn` pattern** at `identity-birth-orchestrator.ts:820-838` — model for the timeout log entry (operation-key + structured fields; best-effort inside try/catch).

### Established Patterns
- **Q2 no-rollback lock** — see `identity-birth-orchestrator.ts:701-717` runStep catch block comment. On step failure, the on-disk identity folder from Step 1 (and everything written afterward: identity file, avatar sibling, relay account) STAYS. This phase preserves that discipline — the wait-timeout path leaves everything on disk per shape §Philosophy.
- **SSH connection lifecycle** — `birthIdentity`'s single `try { ... } finally { conn.end() }` wraps Steps 1-N. The new wait loop runs INSIDE this same try block (same conn), so its polls reuse the connection and cleanup happens naturally after the wait resolves.
- **Injected-deps testability** — `BirthDeps` interface at `:173-297` provides all external calls as injected functions. Add `discoverIdentitySessionFile` (or its SSH-channel-adapter variant if consistent with existing pattern) to `BirthDeps` so unit tests can mock the poll.
- **Existing SSE event contract** at `:127-129` — `BirthEvent` discriminated union. Extension shape: keep `type: "step"` events for log-forensics; the new addition is a wait phase whose events are internal to backend (no new step number needed if we route through the log rather than the wire) OR a new event kind `{ type: "wait", phase: "started" | "completed" | "timed_out" }` for symmetry (planner's call at D-10/D-11 refinement time).
- **`birthProgress` + `birthFailedStep` state** in `NewSessionDialog.tsx` — both deleted under new shape. `birthing` boolean state is the only survivor for gating (disabled fields, disabled close, spinner-in-button).

### Integration Points
- **`birthIdentity` return contract to `identity-birth.ts` SSE route** — the SSE route wires `emit` to `res.write("data: " + JSON.stringify(event) + "\n\n")`. Any new event types added must be JSON-serializable and non-conflicting with the discriminated union.
- **`NewSessionDialog` `handleBirth` at `:690-817`** — the birth stream consumer. Its `for await (const evt of stream)` loop currently branches on `evt.type === "step"` (updates checklist) vs `evt.type === "ended"`. New shape simplifies: drop the step branch entirely; only `ended` matters. Success path (existing L773-802) preserves the `refreshIdentities` + `onCreate` + `onClose` chain. Failure path (existing L803-806) rewrites to call `window.alert("agent creation failed")` before `onClose()`.
- **Modal close mechanism** — the `Dialog` component's `onOpenChange` prop is what user-driven closes route through. Must gate on `!birthing` to prevent the user from closing mid-spin (D-15).
- **`resetBirthProgress` callers** at `NewSessionDialog.tsx:456-458` + call sites at `:521, :693, :809-813` — all need updating when `birthProgress` state is deleted.

</code_context>

<specifics>
## Specific Ideas

- **Reuse the existing transcript-file discovery helper, do not build a second one.** Ashley's direction verbatim: *"it could be looked for the same way that we look for that in other places where we are looking for session transcript files that have the ID invocation as the first message"* — that's `discoverIdentitySessionFile` at `src/backend/claude-session/discover-identity-session-file.ts`. Building a parallel sensor risks drift; use the one the fleet-status axis already trusts.
- **JS alert, literally.** Ashley's direction verbatim: *"the modal just closes and pops a js alert saying agent creation failed"* — this means `window.alert("agent creation failed")` (browser blocking dialog), not a shadcn toast, not an in-modal error state. Confirmed explicitly when I offered toast as an alternative (2026-09-11 discuss).
- **Spinner replaces the Create button's text label** — Ashley's direction verbatim: *"Maybe we just have the spinner show up as a replacement of the text on the create button"*. No separate progress section; the Create button IS the spinner surface.
- **Modal is locked from click to resolution** — Ashley's direction verbatim: *"They aren't allowed to close the modal after they click Create."* Close button disabled during `birthing === true`.
- **Timeout duration = 120s (2 min).** I proposed 60-90s floor + 2× buffer; Ashley agreed.
- **Poll cadence = 2s.** I proposed matching fleet-status default; Ashley agreed.
- **Wait poll lives on the backend inside the SSE stream** (not a separate frontend polling endpoint). Ashley agreed with recommended Option A.

</specifics>

<deferred>
## Deferred Ideas

- **Chunk 4 dissolves under this shape.** Originally scoped as "per-step visible checkmarks + error toast on step-failed." Under this shape there ARE no per-step checkmarks (spinner replaces the whole checklist), and the timeout failure is a JS alert not a toast. The birth-flow rework arc becomes 3 chunks, not 4. Related bounty `newsessiondialog-ux-per-step-visible` in the box-maintainer role's shared pool should be marked done/dropped as part of closing this phase.
- **Chunk 2's workspace-path fallback becomes vestigial after this phase lands** (identity-birth.ts substitution at `~/<name>/` → `~/fleet/identities/<name>/workspace/`) — Skynet no longer uses `path` for its own tmux launch, only shell-only mode does. Do NOT remove Chunk 2's code in this phase — path field is still needed by shell-only branch and by any admin who wants a non-default workdir hint that lands in the identity file's context. Removal (if ever) is a separate cleanup phase.
- **Clone flow cleanup — should `identity-clone.ts` also stop calling `startHarnessOnIdentity` and let the supervisor pick it up?** Same architectural question as this phase, but for the clone code path. Not in scope for Chunk 3. If ever done: separate phase, would allow full deletion of `identity-harness-start.ts`.
- **Downstream deployment (T800 / Stacy) pull-through.** Per Ashley's direction, Stacy pulls the FULL birth-flow rework arc (Chunks 1+2+3) after all three land, not incrementally. Do NOT DM Stacy mid-phase. Standing-directive DM is asked-and-authorized at ship time per role file `## Standing directive: after every ship, ASK about notifying Stacy`.
- **Any richer diagnostic surface for the failure log.** The generic alert plus the backend structured log entry is the full user-facing failure surface under this shape. Making the log richer or exposing it to the operator through some UI is a separate concern (would be its own phase if pursued).

</deferred>

---

*Phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s*
*Context gathered: 2026-09-11*
