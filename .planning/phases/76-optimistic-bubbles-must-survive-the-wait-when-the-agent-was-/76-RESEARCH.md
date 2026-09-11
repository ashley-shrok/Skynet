# Phase 76: Optimistic Bubbles Must Survive the Wait — Research

**Researched:** 2026-09-06
**Domain:** PrettyView dormancy signaling + pending-send timer + bubble failure visuals
**Confidence:** HIGH (all findings based on direct codebase inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Two signal sources exist and must be reconciled into a single authoritative dormancy source. Signal A: `{type:"dormant", dormant:boolean}` — emit-on-change. Signal B: `{type:"pane_state", state:...}` — full re-emit on WS attach.
- **D-02:** The authoritative source is derived from BOTH signals, in one place (a single ref or derived value), not scattered across consumers. Candidates: (a) fire `setDormant` from BOTH the `type:"dormant"` case AND the `type:"pane_state"` case-when-state==="dormant"; (b) introduce `isDormantAuthoritative` = `dormant || paneState === "dormant"` and migrate consumers.
- **D-03:** The read is at arm time and latched to the pending-send for its lifetime. Does not change mid-flight.
- **D-04:** Plan phase must produce an explicit inventory of every frontend surface that reads asleep-versus-awake state or arms a timer tied to a pending-send's lifetime. Every surface on the inventory that currently reads from Signal A gets migrated onto the authoritative source.
- **D-05:** Widened timeout value continues to be sourced by reference to the backend's give-up constants (`MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS_DORMANT`). Named constant `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` stays.
- **D-06:** Whole-bubble red fill on flip-to-failed, not just a red border.
- **D-07:** Multi-send during a widened wait must be verified under real conditions in an in-process test with reconnect-mid-dormancy setup.
- **D-08:** The awake-case pending-send stopwatch (20s / `PENDING_SEND_TIMEOUT_MS_NORMAL`) is unchanged.

### Claude's Discretion
- Exact derivation function for the authoritative dormancy source (D-02 candidates).
- Test framework choice for multi-send-during-reconnect scenario.
- Wave split.
- Exact CSS/tailwind approach for whole-bubble red (D-06).
- Whether to retain the `dormant` state slot at all after unification.

### Deferred Ideas (OUT OF SCOPE)
- Duplicate real bubble bug (sister bounty `pv-queue-op-dedup-doesnt-survive-wake-recycle`).
- Reconnect during the widened wait.
- Cancel-in-flight affordance during the widened wait.
- Interim status text during the spin.
- Retiring the `dormant` state slot (may fall out naturally, may be follow-up cleanup).
</user_constraints>

---

## Summary

Phase 62 shipped a widened pending-send timer for dormant sends (`PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000`) but wired it to `dormantRef.current`, which mirrors the `dormant` React state, which is set only when the backend emits `{type:"dormant", dormant:true}`. The backend emits that frame through its dormant-poll tick using an emit-on-change guard (`dormantLastEmitted`), but in the specific scenario of a WS reconnect while dormant, there is a timing race: the frontend sends `connectToPane` on reconnect, the backend runs discovery and MAY emit `{type:"dormant", dormant:true}` (through the initial `inactive-branch dormancy probe` at line 7813), but the `dormantRef.current` mirror is only updated after a React useEffect cycle. If `handleOptimisticSend` fires BEFORE that useEffect runs — e.g., Alice types fast after WS reconnects — `dormantRef.current` is still `false` and the normal 20s branch fires.

Additionally, Signal B (`{type:"pane_state"}`) is emitted as part of EVERY `connectToPane` attach flow, always carries the current truthful state, and is already stored in `paneState` React state. The fix is to derive a unified authoritative dormancy boolean from BOTH signals, so that even if Signal A has not yet hydrated `dormantRef`, the `paneState === "dormant"` fact from Signal B (which always re-emits on attach) produces the correct result.

**Primary recommendation:** Use derivation option (a) — make `setDormant(true)` fire from the `type:"pane_state"` case when `parsed.state === "dormant"`, in addition to the existing `type:"dormant"` case. This keeps `dormant` as the single authoritative boolean, keeps `dormantRef` as the single authoritative ref, and has zero impact on consumers — no migration needed. Option (b) is also valid but requires migrating every `dormantRef.current` consumer and every `dormant` state reader onto the new derived value, increasing the surface area of change.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dormancy signal reconciliation | Frontend (PrettyView) | — | Wire contract unchanged; both signals already arrive; unification is a frontend-only read change |
| Pending-send timer arm decision | Frontend (PrettyView, handleOptimisticSend) | — | Arm-time read of authoritative ref at send moment |
| Pending-send timer value | Frontend constant (PENDING_SEND_TIMEOUT_MS_DORMANT) | Backend constants (pv-send-watchdog.ts) | Frontend value must track backend ceiling by convention; coupling via comment (D-05) |
| Whole-bubble red visual | Frontend (ChatMessage.tsx) | — | `pendingState === "failed"` prop → inline style; no backend involvement |
| Multi-send ordering | Frontend (FIFO pendingSends array) | Backend (FIFO message delivery) | Both sides already FIFO; verification is a frontend test concern |

---

## Complete Two-Signal Architecture Map

### Signal A: `{type:"dormant", dormant:boolean}`

**Backend origin:** Four emit sites, all in `src/backend/claude-session/claude-session-server.ts`.

| Site | Line | When fires | Condition |
|------|------|------------|-----------|
| Dormant-poll tick (`__applyDormantPollTickForTests`) | 2440–2447 | Every ~3s poll tick while dormant | `isDormant !== state.dormantLastEmitted` — emit-on-change only |
| Dormant-poll rediscovery (`__applyDormantPollWithRediscoveryForTests`) sentinel still present | 3225–3232 | Every ~3s poll tick (rediscovery path) | `state.dormantLastEmitted() !== true` — emit-on-change only |
| Dormant-poll rediscovery sentinel disappeared | 3309–3311 | Sentinel vanishes (wake happened) | `state.dormantLastEmitted() !== false` — emit-on-change only |
| Initial `connectToPane` inactive-branch dormancy probe | 7799, 7813 | On fresh WS attach + discovery returns `inactive` + identity + .dormant present | DIRECT `ws.send()` — NOT guarded by `dormantLastEmitted`; always fires when condition is met |

**`dormantLastEmitted` per-connection semantics:** Declared at line 3684 as `let dormantLastEmitted: boolean | null = null`. It is closure-scoped inside the per-connection WS handler. EVERY new WS connection starts with `dormantLastEmitted = null`. This means:
- The initial-discovery path at line 7799 sets it to `true` directly, then calls `ws.send({type:"dormant", dormant:true})` directly — NOT through the poll-tick guard.
- The poll-tick path at line 2440 uses `isDormant !== dormantLastEmitted` — on a fresh connection, `null !== true === true`, so the FIRST poll tick after reconnect would emit if currently dormant.

**Why Signal A can still miss after reconnect:** The initial-discovery path at line 7774 only runs when `result.reason === "not_claude"`. If the discovery result has a different reason code (`exec_error`, etc.), the dormancy probe does not run, and the `{type:"dormant"}` frame is not emitted at attach time. Additionally, even when it does emit at attach time, there is a timing race: `handleOptimisticSend` reads `dormantRef.current` which is only synced to `dormant` state via a useEffect (asynchronous, runs after render). If Alice types fast enough after WS reconnect, the frame arrives + `setDormant(true)` queues + useEffect hasn't run yet → `dormantRef.current` is still `false`.

**Frontend receive:** `case "dormant":` at `PrettyView.tsx:2147–2156`. Calls `setDormant(parsed.dormant)`.

**Frontend storage:** `const [dormant, setDormant] = useState(false)` at `PrettyView.tsx:715`. `const dormantRef = useRef<boolean>(false)` at `PrettyView.tsx:1413`. Mirror useEffect at `PrettyView.tsx:2555–2560`: `dormantRef.current = dormant` (runs after render, not synchronously).

### Signal B: `{type:"pane_state", state:"active"|"holding"|"dormant"|"inactive"|"error"}`

**Backend origin:** `paneStateEmitter.emit(state, reason?)` is called at these sites in `claude-session-server.ts`:
- `L4149`: `paneStateEmitter.emit("holding", "id_reset")`
- `L4724`: `paneStateEmitter.emit("holding", reason)` (discovery diff)
- `L4802`: `paneStateEmitter.emit("active", "same_file_recovery")`
- `L4915`: `paneStateEmitter.emit("active", "session_changed")`
- `L4974`: `paneStateEmitter.emit("inactive", reason)`
- `L6948`: `paneStateEmitter.emit("active")` — inside `startActiveSessionFlow`, which runs on EVERY WS attach (fresh `connectToPane`) AND on wake-from-dormant
- `L7320`: `paneStateEmitter.emit("dormant")` — emitted by the dormant-poll caller when `dormantLastEmitted` transitions to `true`
- `L7322`: `paneStateEmitter.emit("active", "dormancy_cleared")` — on wake
- `L7819`: `paneStateEmitter.emit("dormant")` — initial `connectToPane` inactive-branch dormancy detection
- `L7971`: `paneStateEmitter.emit("dormant")` — dormant-poll wake path
- `L7973`: `paneStateEmitter.emit("active", "dormancy_cleared")` — dormant-poll wake path
- `L8164`: `paneStateEmitter.emit("inactive", result.reason)`

**`paneStateEmitter` instance:** Created once per WS connection at line 3918. Dedupes on last (state, reason) pair. `emitCurrent()` exists in the API (`pane-state-emitter.ts:194`) but is NEVER called in `claude-session-server.ts` — re-emit on attach happens organically through `startActiveSessionFlow` calling `paneStateEmitter.emit("active")` or the dormancy probe calling `paneStateEmitter.emit("dormant")`.

**Why Signal B is reliable on reconnect:** `startActiveSessionFlow` is called on every `connectToPane` attach (both `result.status === "active"` from cache hit and from fresh discovery), and it unconditionally calls `paneStateEmitter.emit("active")` (line 6948). The dormant attach path (lines 7813, 7819) also calls `paneStateEmitter.emit("dormant")`. So `pane_state` ALWAYS gets emitted on reconnect — either `"active"` or `"dormant"` — and the frontend's `paneState` state is always hydrated correctly.

**Frontend receive:** `case "pane_state":` at `PrettyView.tsx:1761–1787`. Calls `setPaneState(parsed.state)`.

**Frontend storage:** `const [paneState, setPaneState] = useState<PaneState | null>(null)` at `PrettyView.tsx:1447`. `const paneStateRef = useRef<PaneState | null>(null)` at `PrettyView.tsx:1451`. Mirror useEffect at `PrettyView.tsx:2562–2568`: `paneStateRef.current = paneState`. `paneState` is fed to `usePaneResolvingMachine` → `resolveRenderedState` → `renderedState`.

---

## Exhaustive Symmetric-Surface Inventory (D-04 Required Artifact)

### Every read of `dormantRef.current` (production)

| File | Line | Description | Migrate to authoritative source? |
|------|------|-------------|----------------------------------|
| `PrettyView.tsx` | 1233 | `const armedDormant = dormantRef.current === true` — LOAD-BEARING: determines whether to arm 20s or 220s timer at send time | YES — this is the primary bug site. Must read authoritative source. |
| `PrettyView.tsx` | 1241 | `dormantRef.current` read inside `window.setTimeout` callback — `dormant_at_fire` diagnostic log only | Optional: keep as informational "was it still dormant when timer fired" — not load-bearing |
| `PrettyView.tsx` | 1741 | `dormantRef.current &&` — gate for live-frame auto-dismiss (if dormant overlay was up and a live JSONL frame arrives, dismiss it). Also the branch that calls `setDormant(false)` | EVALUATE — this was the original purpose of `dormantRef` (stale-closure read inside WS onmessage handler). After unification, if `dormant` state is now correctly hydrated from both signals, the dismiss logic still needs the stale-closure-safe version. Recommend adding parallel read from paneStateRef for symmetry, but the auto-dismiss path itself (calling `setDormant(false)`) may need to also call something that unifies state if option (a) is not chosen. |

### Every read of `dormant` state slot (production)

| File | Line | Description | Migrate? |
|------|------|-------------|----------|
| `PrettyView.tsx` | 715 | Declaration: `const [dormant, setDormant] = useState(false)` | N/A — this is the slot |
| `PrettyView.tsx` | 2559 | `dormantRef.current = dormant` — mirror useEffect | Stays: this is the synchronization mechanism |

### Every read of `dormantRef.current` (tests)

| File | Line | Description |
|------|------|-------------|
| `PrettyView.optimistic-bubbles.test.tsx` | Test 5b (line 391–445) | Delivers `{type:"dormant", dormant:true}` WS frame before send; asserts 20s does not fire, 220s does. Tests Signal A path only — does NOT cover the pane_state path or the reconnect-then-send scenario. |

### Every read of `paneState` state slot (production)

| File | Line | Description | Migrate? |
|------|------|-------------|----------|
| `PrettyView.tsx` | 1447 | Declaration: `const [paneState, setPaneState] = useState<PaneState | null>(null)` | N/A |
| `PrettyView.tsx` | 1597 | Passed to `usePaneResolvingMachine({ wsTransportState, paneState })` | No — this is the overlay-mount path, not the dormancy-for-send path |
| `PrettyView.tsx` | 3137 | `setPaneState(null)` — on retry click | No — this is the error-recovery path |
| `PrettyView.tsx` | 1648 | `setPaneState(null)` — cold-mount reset | No — correct behavior |
| `PrettyView.tsx` | 3457 | `renderedState === "dormant"` — ComposeBox mount gate (via `usePaneResolvingMachine`) | No — this reads via `renderedState`, not directly |
| `PrettyView.tsx` | 3487–3489 | `renderedState === "dormant"` — `canSend` prop | No — same |

### Every read of `paneStateRef.current` (production)

| File | Line | Description | Migrate? |
|------|------|-------------|----------|
| `PrettyView.tsx` | 1783 | `paneStateRef.current !== parsed.state` — D-18 transition log dedup | No — diagnostic only |
| `PrettyView.tsx` | 2567 | `paneStateRef.current = paneState` — mirror useEffect | N/A |

### Every timer / timeout armed on pending-send / optimistic-bubble lifecycle

| File | Line | Timer | Purpose | Dormancy-related? |
|------|------|-------|---------|-------------------|
| `PrettyView.tsx` | 1242 | `window.setTimeout(callback, timeoutMs)` | THE pending-send timer — fires `flipToFailed` after 20s or 220s depending on `armedDormant` | YES — this is the load-bearing site |
| `PrettyView.tsx` | 1203 | `window.clearTimeout(existing.timer)` — clears the pending timer on `immediateFailure:true` | Not a timer arm; cancel path | No |
| `PrettyView.tsx` | 1163 | `window.clearTimeout(found.timer)` — inside `flipToFailed` | Cancel on flip | No |
| `PrettyView.tsx` | 1276 | `window.clearTimeout(p.timer)` inside `clearAllPendingSends` | Bulk cancel on WS close / session changed | No |

### Non-pending timers (NOT candidates for Phase 76 changes)

| File | Line | Timer | Purpose |
|------|------|-------|---------|
| `PrettyView.tsx` | 770 | `optimisticRecyclingTimerRef` — 10-minute reset-session timer | Not dormancy-related |
| `PrettyView.tsx` | 1100 | `asidePendingTimerRef` — 60s BTW aside pending timer | Not dormancy-related |
| `PrettyView.tsx` | 1613 | `setTimeout(..., 400)` — resolving-spinner paint delay | Not dormancy-related |
| `PrettyView.tsx` | 2402 | `reconnectTimeoutRef` — WS reconnect backoff | Not dormancy-related |
| `PrettyView.tsx` | 2631 | `hiddenPaneCloseTimerRef` — hidden-pane WS debounced close | Not dormancy-related |

### Every consumer that branches on asleep-vs-awake (even indirectly)

| Site | How it branches | Currently reads from | Phase 76 action |
|------|-----------------|---------------------|-----------------|
| `PrettyView.tsx:1233` | `armedDormant` → 20s vs 220s timer | `dormantRef.current` (Signal A only) | MIGRATE to authoritative source |
| `PrettyView.tsx:1741` | Live-frame auto-dismiss gate: `dormantRef.current && (parsed.type === "message" || ...)` → `setDormant(false)` | `dormantRef.current` (Signal A only) | EVALUATE: if option (a) is chosen, `setDormant(false)` already handles this; the `dormantRef.current` guard here is a stale-closure guard for the WS onmessage. Under option (a), `dormantRef` stays as the single ref, just correctly populated from both signals — no change needed to the read. Under option (b), the read needs to change to the new authoritative ref. |
| `PrettyView.tsx:3457` | `renderedState === "dormant"` → ComposeBox mount gate | `paneState` via `usePaneResolvingMachine` (Signal B — already authoritative) | NO CHANGE — already correct |
| `PrettyView.tsx:3487–3489` | `renderedState === "dormant"` → `canSend` | `paneState` via `usePaneResolvingMachine` (Signal B — already authoritative) | NO CHANGE — already correct |

### Every place `{type:"dormant"}` frame is handled on the frontend

| File | Line | Handler |
|------|------|---------|
| `PrettyView.tsx` | 2147–2156 | `case "dormant": { setDormant(parsed.dormant); break; }` — only write site for `dormant` state |

### Every place `{type:"pane_state"}` frame is handled on the frontend

| File | Line | Handler |
|------|------|---------|
| `PrettyView.tsx` | 1761–1787 | `case "pane_state": { ... setPaneState(parsed.state); break; }` — only write site for `paneState` state |
| `PrettyView.phase29.test.tsx` | 169 | Structural grep asserts exactly ONE `case "pane_state"` handler in PrettyView.tsx |

---

## Authoritative-Source Derivation Options Analysis

### Option (a): Feed `setDormant` from BOTH signal cases

**Implementation:** In `PrettyView.tsx` WS onmessage handler, add to the `case "pane_state"` block:
```typescript
case "pane_state": {
  // existing setPaneState(parsed.state) ...
  // ADD: mirror dormant truth from pane_state so dormantRef stays
  // correct even when {type:"dormant"} was missed (e.g., reconnect timing race).
  if (parsed.state === "dormant") {
    setDormant(true);
  } else if (parsed.state === "active" || parsed.state === "holding" || parsed.state === "inactive") {
    // pane_state:active/holding/inactive means NOT dormant
    setDormant(false);
  }
  // pane_state:error — leave dormant unchanged (error is a transport-level state,
  // not a dormancy truth assertion)
  break;
}
```

**What this changes:** `dormant` state slot and `dormantRef` become populated from both signals. `dormantRef.current` at arm time is now the authoritative value. No consumers change.

**Advantages:**
- Zero consumer migration needed — `dormantRef.current` at `PrettyView.tsx:1233` immediately becomes authoritative without changing that line.
- Minimal surface area: two extra `setDormant` calls in the `pane_state` handler.
- All existing tests continue to pass unchanged.
- The auto-dismiss logic at line 1741 requires no change.
- The mirror useEffect at line 2555–2560 requires no change.
- Easiest to test: Test 5c can deliver `{type:"pane_state", state:"dormant"}` instead of `{type:"dormant", dormant:true}` and verify the same timer behavior.

**Disadvantages:**
- Conceptually, `dormant` state now has two write sites (both signal cases). A future reader of the code needs to understand why `setDormant` appears in the `pane_state` handler.
- If `paneState === "dormant"` and `dormant === false` diverge for a reason we haven't considered, this writes `dormant = true` based on `paneState`, which might be surprising.

**Risk assessment:** LOW. The only known divergence case is `paneState === "error"` which this deliberately does not touch. All other paneState values (`active`, `holding`, `dormant`, `inactive`) have unambiguous dormancy mappings.

### Option (b): Introduce `isDormantAuthoritative` derived from both

**Implementation:**
```typescript
// After dormant and paneState are declared:
const isDormantAuthoritative = dormant || paneState === "dormant";
const isDormantAuthoritativeRef = useRef(false);
useEffect(() => {
  isDormantAuthoritativeRef.current = isDormantAuthoritative;
}, [isDormantAuthoritative]);
```
Then migrate `PrettyView.tsx:1233` to read `isDormantAuthoritativeRef.current` instead of `dormantRef.current`.

**What this changes:** New state derived value, new ref, new mirror useEffect. Migration of `PrettyView.tsx:1233` (arm site). Potentially migrate `PrettyView.tsx:1241` (fire log) and `PrettyView.tsx:1741` (auto-dismiss gate).

**Advantages:**
- More explicit semantics — the authoritative value is a named thing.
- Easier to reason about in isolation (just `dormant || paneState === "dormant"`).
- Future: if a third signal is added, extend the derivation in one place.

**Disadvantages:**
- More code surface: new state slot (or computed value), new ref, new mirror useEffect.
- Requires migrating consumers — at minimum line 1233, potentially also lines 1241 and 1741.
- The auto-dismiss logic at 1741 currently reads `dormantRef.current` and calls `setDormant(false)` — after option (b), the auto-dismiss would need to also unset the pane-state-derived component if the authoritative source doesn't automatically clear it.
- Higher test surface: new ref to test, new derivation to verify.

**Recommendation: Option (a).** It achieves the D-02 goal (authoritative source from both signals) with minimum surface area of change. The conceptual cleanliness advantage of option (b) does not outweigh the additional migration work and new ref surface it introduces. Option (a) also naturally handles the "whether to retain the `dormant` state slot" question from Claude's Discretion — it retains the slot, which is fine since the slot is already a useful semantic anchor.

**Important note for option (a) — `pane_state:dormant` + existing `setDormant(false)` race:**
The auto-dismiss at line 1741–1754 calls `setDormant(false)` when a live JSONL frame arrives while `dormantRef.current` is true. Under option (a), this is correct — a live JSONL frame means the agent woke up, so clearing `dormant = false` is right. The `paneState` will also transition to `"active"` shortly after via the `paneStateEmitter.emit("active")` call on wake. No conflict.

---

## Backend `{type:"dormant"}` Emit Semantics and Reconnect Behavior

### The four emit paths

1. **`__applyDormantPollTickForTests` (line 2440–2447):** The regular 3-second dormancy poll. Uses `state.dormantLastEmitted` (per-connection mutable field on a state struct). Change-guard: `isDormant !== state.dormantLastEmitted`. Emits only on transition. [VERIFIED: codebase]

2. **`__applyDormantPollWithRediscoveryForTests` sentinel present (line 3225–3232):** The rediscovery poll (used by `dormantPollTimer`, the 3s loop started in the inactive-branch dormancy detection). Change-guard: `state.dormantLastEmitted() !== true`. Emits only on transition. [VERIFIED: codebase]

3. **`__applyDormantPollWithRediscoveryForTests` sentinel disappeared (line 3309–3311):** Sentinel gone → emit `dormant:false`. Change-guard: `state.dormantLastEmitted() !== false`. Emits only on transition. [VERIFIED: codebase]

4. **Initial `connectToPane` inactive-branch dormancy probe (line 7799, 7813):** Runs on EVERY `connectToPane` WS attach when `result.status === "inactive" && result.reason === "not_claude" && isIdentityShape && .dormant present`. This path DIRECTLY calls `ws.send({type:"dormant", dormant:true})` without going through the `dormantLastEmitted` change guard. Sets `dormantLastEmitted = true`. [VERIFIED: codebase]

### Is there a scenario where the frontend misses all four emits?

YES — the root cause scenario:

The initial-discovery path (emit site 4) only fires when `result.status === "inactive"` AND `result.reason === "not_claude"`. If the cached-session fast-path fires instead (line 7724 `startActiveSessionFlow({ pid: cached.pid, sessionFile: cached.sessionFile, ... })`), the dormancy probe at line 7750 is NEVER reached. In that case, `{type:"dormant"}` is NOT emitted at attach time.

Additionally, even when emit site 4 DOES fire correctly, there is a React timing race: `setDormant(true)` is async (schedules a re-render); `dormantRef.current` is only updated in a useEffect that runs AFTER that render. If `handleOptimisticSend` fires between the `{type:"dormant"}` frame arriving and the useEffect running, `dormantRef.current === false` at arm time even though `dormant === true` will be on the next render.

Signal B (`pane_state:"dormant"`) does NOT have this problem because:
- The `pane_state` frame is emitted alongside `{type:"dormant"}` at EVERY emit site (the paneStateEmitter mirror pattern throughout the server). Every site that emits `{type:"dormant", dormant:true}` also calls `paneStateEmitter.emit("dormant")`.
- `paneState` state is INTENTIONALLY preserved across WS reconnects (the D-11 don't-flicker rule). So even if a reconnect happens and `pane_state` is slightly delayed, the previous `paneState === "dormant"` persists until the fresh one arrives.

Under option (a), `pane_state:dormant` arriving will call `setDormant(true)`, which means `dormant` is now fed from the faster / more reliable channel. This eliminates the race because `paneState === "dormant"` is always correctly set before or at the same time as `{type:"dormant", dormant:true}` arrives.

### `dormantLastEmitted` per-connection vs per-session

**Per-connection.** Declared at `claude-session-server.ts:3684` as `let dormantLastEmitted: boolean | null = null` inside the per-WS connection closure. EVERY new WS connection starts with `dormantLastEmitted = null`. This is by design — the closure holds all per-connection state.

**On WS reconnect:** Fresh connection → `dormantLastEmitted = null`. The initial-discovery path sets it directly to `true` before calling `ws.send()` (line 7799). The 3s poll tick checks `null !== isDormant` which is `true` on first tick if dormant — so the first poll tick after reconnect WOULD also emit `{type:"dormant"}` as a change. Both paths cooperate to hydrate the fresh connection.

**Is the backend `dormantLastEmitted = null` → emit-on-first-tick a bug or a feature?** Feature. The `null` initial value is deliberate — it means "I don't know what I sent this client yet" and correctly triggers a fresh emit on the first observation. The backend WILL re-emit `{type:"dormant"}` on reconnect through the poll tick if the initial-discovery path misses it. The race is entirely on the FRONTEND side (useEffect timing).

---

## Whole-Bubble Red Visual — Current Failure State Rendering

### Current implementation

In `src/ui/features/pretty-view/ChatMessage.tsx`:
- `pendingState === "failed"` → `showFailedBubble = true` (line 395)
- `bubbleInlineStyle` when `showFailedBubble`:
  ```typescript
  {
    position: "relative",
    borderColor: "hsla(0, 60%, 55%, 0.4)",     // muted red border only
    backgroundColor: "hsla(0, 40%, 50%, 0.08)", // nearly-invisible tint
  }
  ```
  (lines 402–408) [VERIFIED: codebase]
- The `data-pv-bubble-failed="true"` attribute is applied to the bubble container (line 415)
- The underlying user-bubble has a `bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]` background from the className (line 451)
- The current approach uses inline `borderColor` + `backgroundColor` to LAYER over the existing gradient — the gradient is not replaced, it shows through the 8% alpha red tint

### Current visual result

A bubble with a muted red border (`hsla(0, 60%, 55%, 0.4)`) and a barely-visible reddish tint (`hsla(0, 40%, 50%, 0.08)`) over the standard blue-gray gradient. Alice confirmed this looks like "just a red border."

### D-06 target

Whole-bubble red fill — the entire bubble should be red, not just an outline. "The whole bubble just turn red instead of the blue hue that normal messages have."

### CSS approach options for the planner

The user bubble gets its blue-gray gradient from the className at line 451. To achieve a whole-bubble red fill, the simplest approach that aligns with how the existing identity-hue system works is to change `backgroundColor` to a strong opaque red and also adjust `borderColor` to a saturated red. However, the gradient from the className will still show through unless overridden.

Two viable approaches:
1. **Override via inline style:** Set `background: "hsla(0, 60%, 35%, 0.90)"` or similar in `bubbleInlineStyle` — this overrides the className's gradient via inline-style specificity. Add `borderColor: "hsla(0, 70%, 50%, 0.8)"`.
2. **Conditional className:** Add a Tailwind class like `bg-[hsla(0,60%,35%,0.90)]` conditionally when `showFailedBubble`. Tailwind's inline approach requires a safelisted class or JIT-generated value.

The planner should decide the exact color values. The existing `data-pv-bubble-failed` attribute and the `pendingState === "failed"` → `showFailedBubble` boolean are already in place — only the inline style values need changing.

---

## Multi-Send-During-Wake Test Scenario Feasibility

### Current test infrastructure

The test harness in `PrettyView.optimistic-bubbles.test.tsx` uses:
- `wsStubs: WsStub[]` array — every `openClaudeSessionSocket()` call pushes a new stub
- `getCurrentWs()` returns `wsStubs[wsStubs.length - 1]` — always the newest WS
- `flipToStreaming(ws)` sends `onopen` + `{type:"session"}` frame
- `sendWsFrame(ws, frame)` sends an arbitrary frame to a specific WS stub
- `ws.onclose?.()` + `setRetryKey((k) => k+1)` would trigger reconnect — but the test harness uses a `wsStubs` array where new connections are pushed automatically by the mock

### Is there a reconnect pattern in the existing tests?

Test 12 (`WS close cleanup`) calls `ws.onclose?.()` and verifies pending timers clear. Test 12b verifies `session_changed` clears pendingSends. Neither test simulates a reconnect + re-send.

**No existing test covers:** session-goes-dormant → WS-closes-and-reconnects → `dormantRef.current` is false on the new WS → send arms 20s branch instead of 220s.

### How to drive the D-07 reconnect-mid-dormancy scenario

The test harness already supports multiple WSs (the `wsStubs` array grows on reconnect). The pattern for Test 5c would be:

```typescript
// 1. Establish initial connection
const ws1 = getCurrentWs();
flipToStreaming(ws1);
// 2. Deliver dormant frame → dormant=true, dormantRef.current=true (after effect)
sendWsFrame(ws1, { type: "dormant", dormant: true });
sendWsFrame(ws1, { type: "pane_state", state: "dormant" });
await act(async () => { await Promise.resolve(); }); // let effects settle
// 3. Simulate WS close (reconnect) WITHOUT sending dormant frame on new connection
act(() => { ws1.readyState = 3; ws1.onclose?.(); });
await act(async () => { setRetryKey triggered → new WS created });
const ws2 = getCurrentWs(); // fresh WS
flipToStreaming(ws2); // sends session frame but NOT dormant frame
// 4. Now paneState was preserved (D-11), but dormantRef.current might be false
//    Under the fix: pane_state:dormant will have been set, and setDormant(true)
//    called from the pane_state handler, so dormantRef stays true.
//    Under the old code: dormantRef.current is false → wrong branch
// 5. User sends two messages back-to-back
typeAndEnter(container, "message-one");
typeAndEnter(container, "message-two");
// 6. Verify both arm the 220s branch
// 7. Deliver user frames to match both
// 8. Verify both clear, in order
```

The closest analog is Test 12 (WS close) combined with Test 5b (dormant arm). Test 5c extends this by verifying the reconnect path.

**Technically feasible with the existing harness.** The test can:
1. Deliver a `{type:"pane_state", state:"dormant"}` frame on ws1 (instead of relying on `{type:"dormant"}`) to establish authoritative dormancy
2. Fire `ws1.onclose?.()` to simulate reconnect
3. Note: the `retryKey` bump that triggers reconnect happens in PrettyView's `ws.onclose` handler. In the test, `ws.onclose?.()` fires the handler and the mock pushes a new WS stub.
4. NOT deliver a `{type:"dormant"}` frame on ws2 — simulating the race
5. Verify that sends still arm the 220s timer because `paneState` preserved from before reconnect still says `"dormant"`, which now drives `dormantRef` via option (a)

---

## Diagnostic Logging — Current State and Recommended Additions

### Existing `[diag-dormant-send]` log points

| Log point | File | Line | Fields |
|-----------|------|------|--------|
| `arm` | PrettyView.tsx | 1240 | `mqid`, `dormant=${armedDormant}`, `timeoutMs`, `arm_reason`, `collapsedLen`, `pendingCount`, `now` |
| `fire` | PrettyView.tsx | 1243 | `mqid`, `elapsedMs`, `dormant_at_arm`, `dormant_at_fire`, `branch`, `pendingCount`, `stillPending` |
| `flip-to-failed` | PrettyView.tsx | 1166 | `mqid`, `reason`, `elapsedMs`, `foundState`, `contentLen` |
| `cleanup` | PrettyView.tsx | 1278 | `mqid`, `matched_by`, `elapsedMs`, `replaced`, `state` |
| `cleanup (fifo-match)` | PrettyView.tsx | 1846 | `mqid`, `matched_by=fifo-head-match`, `elapsedMs`, `replaced=true`, `incoming_eventId`, `incoming_line`, `pendingCountBefore`, `preview` |
| `incoming-user-frame` | PrettyView.tsx | 1850 | `mqid=n/a`, `matched_by=none`, `pendingCountBefore`, `incoming_eventId`, `incoming_line`, `action=newBubble` |
| `ws-paste-send-failed` | PrettyView.tsx | 2328 | `mqid`, `reason`, `action=flipToFailed-from-backend-frame` |
| `ws-send-keys-error` | PrettyView.tsx | 2339 | `mqid`, `reason`, `action=flipToFailed-from-backend-frame` |
| `dedup-drop` | PrettyView.tsx | 324, 368 | `path`, `incoming_matrixEventId`, `incoming_eventId` |

### Recommended minimal additions post-fix

The key diagnostic gap after the fix: "did the authoritative source correctly read dormant from paneState (Signal B) rather than dormantRef (Signal A)?" The `arm` log currently only shows `dormant=${armedDormant}` — not WHERE that value came from.

Recommended additions:
1. In the `arm` log (line 1240), add `pane_state=${paneState ?? 'null'} dormant_signal=${dormant}` — this lets Alice (and any post-deploy analysis) see BOTH signal values at arm time, distinguishing which one drove the authoritative result.
2. If option (a) is chosen, add a log in the `pane_state` handler when `setDormant` is called from it: `[diag-dormant-send] pane-state-drove-dormant state=${parsed.state} dormant_before=${dormant}` — proves the fix is activating on real deploys.

These two additions make a post-deploy repro self-diagnosing: `dormant_signal=false pane_state=dormant` in the `arm` log would immediately show the old bug still firing; `dormant_signal=true pane_state=dormant` shows both signals agree; `pane-state-drove-dormant state=dormant` shows the new code path ran.

---

## Risks and Landmines

### Risk 1: Does `dormantRef.current` consumer at line 1741 depend on emit-on-change semantics?

The auto-dismiss logic at `PrettyView.tsx:1741` checks `dormantRef.current && (live frame type)` → calls `setDormant(false)`. This is designed to dismiss the "dormant overlay" when a live JSONL frame arrives (indicating the agent has woken up on its own). Under option (a), `setDormant(false)` is also called when `pane_state` transitions to `active`, `holding`, or `inactive`. So the auto-dismiss logic still works — it just has an additional clear path via pane_state. No conflict.

**One edge case:** If `pane_state:active` arrives BEFORE the live JSONL frame (which is likely — pane_state fires at wake entry before any content), `dormant` would already be `false` when the JSONL frame arrives. The check `dormantRef.current &&` would evaluate to `false` and the `setDormant(false)` call inside the block would not run (already false). This is correct behavior, not a bug.

**Verdict:** No consumer depends on emit-on-change semantics. Safe to expand.

### Risk 2: Is `paneState === "dormant"` ALWAYS equivalent to `dormant === true`?

**Yes, with one qualification.** Every backend path that emits `{type:"dormant", dormant:true}` also calls `paneStateEmitter.emit("dormant")` (verified by tracing all four emit sites above). Every backend path that emits `{type:"dormant", dormant:false}` also calls `paneStateEmitter.emit("active", ...)`. So the two signals are always co-emitted.

**The one divergence case:** `paneState === "error"` means the WS transport failed permanently. In that state, `dormant` could be either true or false from its last emission. Under option (a), `pane_state:error` does NOT call `setDormant` (the code explicitly does not handle `error` in the dormant-mirror logic). This is correct — `paneState:error` is a WS transport state, not a session dormancy state.

**The `inactive` case:** `paneState === "inactive"` means no active Claude session. `dormant` would be `false` in this case (the backend emits `dormant:false` before transitioning to inactive, or the session was never dormant). Under option (a), `pane_state:inactive` would call `setDormant(false)` — which is correct.

**The `holding` case:** Session is in holding state (between sessions). `dormant` would be `false`. Under option (a), `pane_state:holding` calls `setDormant(false)` — correct.

**Verdict:** Equivalence holds in all normal cases. The `error` carve-out is deliberate and correct.

### Risk 3: Does `paneState` full-re-emit-on-attach have known bugs?

**No known bugs identified.** The `pane_state` emit path goes through `paneStateEmitter` which dedupes on last `(state, reason)`. On reconnect, the emitter is freshly instantiated (per-connection closure), so dedupe state resets. The `startActiveSessionFlow` always calls `paneStateEmitter.emit("active")` unconditionally on attach. The dormant attach path always calls `paneStateEmitter.emit("dormant")`. Both paths are unconditional at attach time.

The comment at `PrettyView.tsx:2669–2680` explicitly documents that `paneState` is NOT reset on WS-pause reconnect (the D-11 don't-flicker rule), and that the backend emits `pane_state` on attach to update it. This is the intended design. [VERIFIED: codebase]

**Potential stale-hydration case:** If the backend takes more than 400ms to respond with a `pane_state` frame after reconnect, the `showResolvingSpinner` paint-delay effect fires. The `paneState` state still holds the last-known value from before the drop (D-11 rule). The new `pane_state` frame arrives and updates it. This is correct and tested (Test F in `PrettyView.phase29.test.tsx`). No dormancy-related bug here.

### Risk 4: Could option (a) create a visible re-render cycle?

Under option (a), receiving `pane_state:dormant` calls BOTH `setPaneState("dormant")` and `setDormant(true)`. If `dormant` was already `true` (from a prior `{type:"dormant"}` frame), React batches these state updates (they happen in the same event handler). The `setDormant(true)` when `dormant === true` is a no-op from React's perspective (same value, no re-render). No visible cycle.

---

## Standard Stack

This phase is a pure codebase edit — no new packages.

| Library | Purpose | Notes |
|---------|---------|-------|
| Vitest + React Testing Library | Tests | Already in use; extend existing test file |
| React useState / useRef / useEffect | State management | Same patterns as existing code |

### No Package Legitimacy Audit needed — zero new packages introduced.

---

## Code Examples

### Current arm site (load-bearing consumer — Phase 62 shipped code)
```typescript
// PrettyView.tsx:1227–1244 [VERIFIED: codebase]
// Phase 62 Wave 1 — reads dormantRef.current at arm time.
// BUG: dormantRef is only hydrated by {type:"dormant"} (Signal A),
// which can be stale if the WS reconnected while dormant.
const armedDormant = dormantRef.current === true;
const timeoutMs = armedDormant
  ? PENDING_SEND_TIMEOUT_MS_DORMANT
  : PENDING_SEND_TIMEOUT_MS_NORMAL;
const timeoutReason = armedDormant
  ? "client_timeout_220s_dormant"
  : "client_timeout_20s_normal";
console.info(`[diag-dormant-send] arm mqid=${mqid} dormant=${armedDormant} timeoutMs=${timeoutMs} arm_reason=${timeoutReason} ...`);
const armSentAt = Date.now();
const timerHandle = window.setTimeout(() => {
  console.info(`[diag-dormant-send] fire mqid=${mqid} ... dormant_at_arm=${armedDormant} ...`);
  flipToFailed(mqid, timeoutReason);
}, timeoutMs);
```

### Current `case "dormant"` handler (Signal A receiver)
```typescript
// PrettyView.tsx:2147–2156 [VERIFIED: codebase]
case "dormant": {
  setDormant(parsed.dormant);
  // Phase 56: dormancy is now invisible. Backend still emits for internal tracking.
  break;
}
```

### Current `case "pane_state"` handler (Signal B receiver — extract)
```typescript
// PrettyView.tsx:1761–1787 [VERIFIED: codebase]
case "pane_state": {
  console.info(`[pane-state] received phase=${parsed.state} ...`);
  if (paneStateRef.current !== parsed.state) {
    console.info(`[pane-state] state-transition from=${paneStateRef.current ?? 'null'} to=${parsed.state} ...`);
  }
  setPaneState(parsed.state);
  break;
}
```

### Current dormantRef mirror useEffect
```typescript
// PrettyView.tsx:2555–2560 [VERIFIED: codebase]
// quick 260808-cd6: dormantRef mirror — keeps dormantRef.current in sync
// with the `dormant` state for stale-closure-safe reads inside WS onmessage.
useEffect(() => {
  dormantRef.current = dormant;
}, [dormant]);
```

### Current failed bubble inline style (ChatMessage.tsx — what needs to change for D-06)
```typescript
// ChatMessage.tsx:402–408 [VERIFIED: codebase]
// CURRENT: border-only treatment — D-06 target is whole-bubble red fill
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      borderColor: "hsla(0, 60%, 55%, 0.4)",      // muted red border
      backgroundColor: "hsla(0, 40%, 50%, 0.08)",  // barely-visible tint
    }
  : { position: "relative" };
```

### Current user-bubble base className (relevant for D-06 — what the gradient override must defeat)
```typescript
// ChatMessage.tsx:451–455 [VERIFIED: codebase]
// User bubble base gradient — whole-bubble red must override this:
"bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
"text-[#dfe3ee]",
"border-[rgba(120,140,180,0.2)]",
"shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
```

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — Validation Architecture section omitted per config.

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` in config.

**Applicable ASVS categories for this phase:**

| ASVS Category | Applies | Notes |
|---------------|---------|-------|
| V2 Authentication | No | No auth changes |
| V3 Session Management | No | Session lifecycle unchanged on the wire |
| V4 Access Control | No | No permission changes |
| V5 Input Validation | No | No new inputs from users; timer values are constants |
| V6 Cryptography | No | No crypto changes |

**No security concerns identified.** This phase changes:
1. The condition under which `setDormant(true)` is called (adds a second trigger path from `pane_state` handler)
2. The pending-send timer branching (should now take the 220s branch when truly dormant)
3. The failed-bubble visual (CSS values only)
4. One new test

None of these introduce new attack surfaces. The `pane_state` wire frame is already trusted (same trust boundary as all other WS frames from the backend). The dormancy boolean has no security implications — it controls only the timeout duration of a UI element.

---

## State of the Art

| Old Approach | Current Approach (post Phase 62) | Phase 76 Target |
|--------------|----------------------------------|-----------------|
| Single 20s timer regardless of dormancy | 20s normal, 220s dormant — but only if `dormantRef.current` was true at arm time | 20s normal, 220s dormant — when EITHER signal confirms dormancy at arm time |
| `dormantRef` fed only by `{type:"dormant"}` frames | Same | `dormantRef` fed by BOTH `{type:"dormant"}` AND `{type:"pane_state", state:"dormant"}` |
| Failed bubble = red border + slight tint | Same (Phase 50/62 unchanged this visual) | Whole-bubble red fill |

---

## Open Questions

1. **Is there a timing case where `pane_state:dormant` arrives BEFORE `connectToPane` completes and the `dormant` state from a PRIOR connection was `false`?**
   - What we know: `paneState` is NOT reset on WS-pause reconnect (line 2669–2680). If the previous `paneState` was already `"dormant"`, it stays `"dormant"` through the reconnect. Under option (a), this means `dormant` would already be `true` before any new frame arrives.
   - What's unclear: If the session transitioned from dormant → active → dormant between two WS reconnects (unlikely in practice), could there be a frame ordering issue?
   - Recommendation: This is an edge case unlikely to matter in practice. Option (a) is robust because both signals update `dormant` — whichever arrives first sets the correct value.

2. **Should `clearAllPendingSends` (called on WS close) interact with the dormant state?**
   - What we know: `clearAllPendingSends` fires on WS close (line 1285) and on `session_changed` (line 2299) and on session-rotation (line 1821). It does NOT reset `dormant` or `paneState`.
   - What's unclear: If sends are cleared on WS close (reconnect path), and then the user sends again on the fresh WS, should those new sends get the correct dormant branch? YES — under the fix, `dormantRef.current` will be correct on the fresh WS because `paneState` is preserved.
   - Recommendation: No change needed to `clearAllPendingSends`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The initial `connectToPane` dormancy probe at line 7774 only runs when `result.reason === "not_claude"` — there are no other dormancy probe paths on attach | Backend emit semantics | If wrong, dormant frame may also be emitted via other paths, meaning the miss scenario is narrower than thought (bug would be even rarer in practice). Phase 76 fix is still correct. |
| A2 | `paneStateEmitter` is instantiated per WS connection (not shared across reconnects) | Backend architecture | Confirmed by line 3918: `createPaneStateEmitter({ wsSend })` is called inside the per-connection handler. If wrong (shared), dedupe would suppress re-emits on reconnect — but tests show this isn't the case. |

**If this table is empty after A1-A2:** All other claims in this research were verified by direct codebase inspection with line numbers.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this phase is pure TypeScript/React code changes + test extensions within the existing Vitest test infrastructure).

---

## Sources

### Primary (HIGH confidence — direct codebase inspection with line numbers)
- `src/ui/features/pretty-view/PrettyView.tsx` — dormant/paneState state, dormantRef, paneStateRef, handleOptimisticSend, WS onmessage handler (all signal receivers and consumers)
- `src/ui/features/pretty-view/ChatMessage.tsx` — pendingState prop, failed bubble styling
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — existing test infrastructure, Test 5b anatomy
- `src/backend/claude-session/claude-session-server.ts` — all four `{type:"dormant"}` emit sites, `dormantLastEmitted` per-connection semantics, paneStateEmitter call sites
- `src/backend/claude-session/pane-state-emitter.ts` — `emitCurrent()` API (unused), dedupe semantics, emit-on-attach property
- `src/backend/claude-session/pv-send-watchdog.ts` — `MARKER_FALLBACK_MS_MIRROR = 90_000`, `GIVE_UP_MS_DORMANT = 120_000` (confirmed values per Phase 62 D-62-02)
- `src/ui/features/pretty-view/resolve-phase.ts` — truth table for `paneState → renderedState`
- `src/ui/features/pretty-view/usePaneResolvingMachine.ts` — trivial wrapper
- `src/ui/features/pretty-view/PrettyView.phase29.test.tsx` — structural grep gates, pane_state architecture tests
- `.planning/phases/62-*/62-CONTEXT.md` and `62-01-SUMMARY.md` — exact Phase 62 changes
- `.planning/phases/76-*/76-CONTEXT.md` — locked decisions D-01 through D-08
- `.planning/shapes/shape-optimistic-during-dormant-wake.md` — shape file, scope edges
- `.planning/config.json` — `nyquist_validation: false` (Validation Architecture section omitted)
- `~/.claude/roles/box-maintainer/bounties/pv-client-pending-send-timer-dormancy-blind/bounty.json` — 2026-09-06 tiffany repro trace (`dormant_at_arm=false`)

### Secondary (MEDIUM confidence)
- None — all findings from direct codebase inspection.

### Tertiary (LOW confidence)
- None — no WebSearch findings used.

---

## Metadata

**Confidence breakdown:**
- Signal architecture: HIGH — direct codebase inspection with line numbers
- Root cause: HIGH — consistent with 2026-09-06 log trace `dormant_at_arm=false` and React useEffect timing semantics
- Fix recommendation (option a vs b): HIGH — both are feasible; recommendation based on surface-area analysis
- Backend `dormantLastEmitted` per-connection semantics: HIGH — line 3684
- Whole-bubble red visual: HIGH — exact CSS values from ChatMessage.tsx
- Multi-send test feasibility: HIGH — existing harness supports wsStubs array multi-WS pattern

**Research date:** 2026-09-06
**Valid until:** 60 days for stable codebase (this is an internal fix, no external API changes)
