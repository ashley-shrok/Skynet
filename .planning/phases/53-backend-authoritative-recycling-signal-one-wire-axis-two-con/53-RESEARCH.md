# Phase 53: Backend-Authoritative Recycling Signal — Research

**Researched:** 2026-08-21
**Domain:** Fleet-status wire extension + SSH sentinel read + browser store axis + consumer surface swap
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- The recycling signal source of truth moves to the backend poller reading `.recycled-at` on each managed box.
- One new optional boolean axis (`recycling`) on the fleet-status wire — no schema version bump (additive-optional pattern, T-41-03-05 applies).
- Both consuming surfaces (PrettyView holding overlay AND PrettyConversationRow spinner) rewire to the same store axis.
- The client-side `session-recycling-store.ts` is retired entirely after the two consumers rewire.
- The pretty-view's connection-drop overlay path is a separate concern and stays untouched.
- Recycling means specifically "identity is being replaced via the reset routine" — not harness-down, dormancy-wake, or memory-cap restarts.
- Queue-pending going backend-authoritative is deferred / ruled out for this phase.

### Claude's Discretion

- Exact ordering of tasks within waves (within the serial constraints imposed by file overlap).
- Where in the `processPid` pipeline to place the `.recycled-at` stat relative to the existing `.dormant` stat.
- Whether to add a source B enumeration for recycling-only identities with no live PID (decision: NOT needed — recycling is a transient 8–30s window during which the identity always has a live tmux session and recent PID churn; source A per-PID coverage is sufficient).

### Deferred Ideas (OUT OF SCOPE)

- Queue-pending going backend-authoritative.
- Unifying the fleet-status wire into a grand session-state framework.
- Broader refactor of the client-side state layer.
- Any behavior for "harness is down but no recycling marker" — separate state.
</user_constraints>

---

## Summary

Phase 53 is a pure axis-addition phase. The caretaker on each managed box already writes and
removes `.recycled-at` exactly right: renamed from `.recycle-requested` the moment reconcile
detects the intent (before the old claude process is killed), removed 8 seconds after the
fresh instance is up and has been driven through its `/id` load. The sentinel is on-disk
continuously with no gaps across the full recycling window.

The SSH poller already reads adjacent sentinel files per identity per tick (`.dormant` was
added in Phase 52). Extending it to also read `.recycled-at` is a one-block addition to the
`processPid` function using the exact same `stat … && echo yes || echo no` pattern. The derived
boolean flows into `SessionState` and the fingerprint, which causes a wire frame publish on
any recycling state change. The browser working-store grows a fifth axis (`recycling: boolean`
on `WorkingRecord`) with direct swap-and-notify semantics — identical to the dormant axis
(Axis D) added in Phase 52. Two hooks expose the new axis. Then the two consumer surfaces
swap their signal source from the retired `session-recycling-store` to the new store hook.
The old store is deleted.

**Primary recommendation:** Clone the Phase 52 dormant axis pattern verbatim, substituting
`.recycled-at` for `.dormant`. No source B enumeration needed. The full change set is four
files in Wave 1 (wire types — backend and frontend mirror, orchestrator, working-store) and
three files in Wave 2 (PrettyView.tsx, PrettyConversationsPanel.tsx, retire the store). One
test file per modified module.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recycling sentinel presence | Managed box (supervisor) | — | `.recycled-at` written/removed by `agent-supervisor` only |
| Sentinel detection | API / Backend (ssh-poll-orchestrator) | — | SSH exec per PID-tick, same channel as other sentinel reads |
| Wire publication | API / Backend (fleet-status registry) | — | Existing `publishSessionState` path unchanged |
| Browser state | Frontend store (session-working-store) | — | New Axis E mirrors dormant Axis D exactly |
| Overlay trigger | Frontend (PrettyView.tsx) | — | Rewires from `renderedState === "holding"` gate to `useSessionIsRecycling(key)` |
| Row spinner | Frontend (PrettyConversationsPanel) | — | Rewires from `useSessionRecycling` (old store) to `useSessionIsRecycling` (new hook) |

---

## Standard Stack

No new packages. All changes use existing infrastructure.

### In-Scope Files

| File | Change Type | Purpose |
|------|------------|---------|
| `src/backend/fleet-status/wire-protocol.ts` | Extend field | Add `recycling?: boolean \| null` to `SessionStateSchema` |
| `src/ui/api/fleet-status-types.ts` | Extend interface | Mirror `recycling?: boolean \| null` on browser-side `SessionState` |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | Extend `processPid` | Stat `.recycled-at` sentinel per PID-tick; stamp into state + fingerprint + cache |
| `src/ui/state/session-working-store.ts` | Add Axis E | `recycling: boolean` on `WorkingRecord`; `useSessionIsRecycling` hook; Axis E swap-and-notify block |
| `src/ui/features/pretty-view/PrettyView.tsx` | Source swap | Remove `publishSessionRecycling` call; consume `useSessionIsRecycling` instead |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Source swap | Replace `useSessionRecycling` (old store) with `useSessionIsRecycling` (new working-store hook) |
| `src/ui/state/session-recycling-store.ts` | DELETE | No remaining consumers after the two swaps above |

### Files That Must NOT Change

- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` — overlay component itself stays
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — only the `isRecycling` prop source changes at the `PrettyConversationRowLive` wrapper, not the row component itself
- `docker/nginx.conf` / `docker/nginx-https.conf` — no new HTTP routes
- Any `pane_state` / `session_holding` / connection-drop overlay plumbing

## Package Legitimacy Audit

No external packages installed. Package legitimacy gate: N/A.

---

## Architecture Patterns

### System Architecture Diagram

```
agent-supervisor (managed box)
  └─ writes ~/.claude/identities/<name>/.recycled-at  [at recycle start]
  └─ removes same file ~8s after fresh claude is up   [delayed rm, disowned]

ssh-poll-orchestrator (Skynet backend, per 2s tick)
  └─ processPid()
       ├─ [existing] stat .dormant sentinel → derivedDormant
       ├─ [NEW]      stat .recycled-at sentinel → derivedRecycling
       ├─ compose SessionState { ..., dormant, recycling }
       └─ computeFingerprint() — recycling is a distinct axis

fleet-status registry → WebSocket → browser

session-working-store (browser)
  └─ publishFleetStatusSessionState()
       ├─ Axis A: isWorking
       ├─ Axis B: lastMessageAt
       ├─ Axis C: aiTitle
       ├─ Axis D: dormant              [Phase 52]
       └─ Axis E: recycling            [NEW Phase 53]

Consumers:
  PrettyView.tsx
    BEFORE: useEffect publishes to session-recycling-store when renderedState === "holding"
    AFTER:  useSessionIsRecycling(key) from working-store → showOverlay predicate

  PrettyConversationRowLive (in PrettyConversationsPanel.tsx)
    BEFORE: useSessionRecycling(sessionKey) → isRecycling prop
    AFTER:  useSessionIsRecycling(sessionKey) → isRecycling prop

  session-recycling-store.ts  →  DELETED
```

### Recommended File Structure (unchanged, no new files)

No new files are created. One file is deleted (`session-recycling-store.ts`).
Its test file (`session-recycling-store.test.ts`) is also deleted.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recycling detection | Custom event, pane-state observer, or client-inferred timer | `stat .recycled-at && echo yes \|\| echo no` on the SSH channel | Supervisor is the only ground truth; already an on-disk file |
| Boolean axis on store | New store module | Axis E on `session-working-store` (same pattern as Axis D) | Avoids the exact problem this phase fixes: another per-pane-mounted observer |
| Fingerprint accounting | Separate serialization | Extend the existing `computeFingerprint` template literal | Guarantees recycling-only flips publish a new frame |

---

## Common Pitfalls

### Pitfall 1: Not accounting for recycling in the fingerprint
**What goes wrong:** The recycling boolean changes (sentinel appears on disk) but no new `SessionState` frame is emitted because the fingerprint didn't change.
**Why it happens:** Adding the field to `SessionState` but not to `computeFingerprint`.
**How to avoid:** Extend the fingerprint template literal with `|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}` — exact same pattern as dormant on line 425 of `ssh-poll-orchestrator.ts`.
**Warning signs:** `grep "recycling" src/backend/fleet-status/ssh-poll-orchestrator.ts | grep computeFingerprint` returns nothing.

### Pitfall 2: PrettyView overlay losing its separate "connection drop" path
**What goes wrong:** The rewrite conflates "recycling is happening" with "connection to the central box dropped" and breaks the connection-drop overlay.
**Why it happens:** Misreading the CONTEXT.md scope — the connection-drop overlay is driven by `wsTransportState`, not by `renderedState === "holding"`.
**How to avoid:** The new overlay trigger in PrettyView reads `useSessionIsRecycling(key)` from the working-store. The connection-drop overlay is a separate branch. The Phase 53 change only replaces the `publishSessionRecycling(key, renderedState === "holding")` effect — it does NOT touch `usePaneResolvingMachine`, `paneState`, or `wsTransportState`.
**Warning signs:** `grep "wsTransportState" PrettyView.tsx` touches in the same diff as the recycling change.

### Pitfall 3: Axis E undefined-preservation on Axis A republish
**What goes wrong:** When `isWorking` changes (Axis A fires) but `state_arg.recycling` is undefined on that frame, the Axis A block overwrites `recycling` with `false` (the default) instead of preserving the cached value.
**Why it happens:** Copying the Axis A `nextMap.set(...)` block without adding `recycling: existing?.recycling ?? false`.
**How to avoid:** Axis A must preserve ALL other axes from cache: `recycling: existing?.recycling ?? false`. This is the same pattern used for dormant in the Phase 52 implementation.
**Warning signs:** A recycling flip appears briefly then resets to false on the next isWorking change.

### Pitfall 4: session-recycling-store retirement leaving dangling imports
**What goes wrong:** Deleting the store file while `PrettyView.tsx` or `PrettyConversationsPanel.tsx` still import from it causes a build failure.
**Why it happens:** Forgetting to swap the import in one of the two consumers before deleting the store.
**How to avoid:** Execute the consumer rewires (Wave 2) before deleting the store, and run `npx tsc --noEmit` after each step. Delete the store file only as the final step in Wave 2.
**Warning signs:** Build error referencing `@/state/session-recycling-store`.

### Pitfall 5: PrettyView — removing the useEffect without removing the import
**What goes wrong:** `publishSessionRecycling` stays imported in PrettyView.tsx but is no longer called (dead import warning or stale reference).
**Why it happens:** Incomplete cleanup of the effect.
**How to avoid:** Remove both the import statement (line 58: `import { publishSessionRecycling } from "@/state/session-recycling-store"`) and the useEffect block (lines 2422–2425) in the same edit.

### Pitfall 6: PrettyConversationsPanel — wrong hook name
**What goes wrong:** Swapping to the working-store hook but importing `useSessionIsDormant` instead of `useSessionIsRecycling` (misread autocomplete).
**Why it happens:** Both hooks live in `session-working-store.ts` with similar names.
**How to avoid:** Verify grep confirms `useSessionIsRecycling` is exported from the working-store before touching PrettyConversationsPanel.

### Pitfall 7: fleet-status-types.ts not updated
**What goes wrong:** TypeScript strict mode is off (`strict: false` in tsconfig.app.json), so accessing `state_arg.recycling` on the non-updated `SessionState` interface compiles fine but is undocumented and confusing.
**Why it happens:** Phase 52 also missed adding `dormant` to `fleet-status-types.ts` (the frontend mirror). TypeScript didn't catch it because strict mode is off.
**How to avoid:** Phase 53 MUST add `recycling?: boolean | null` to the `SessionState` interface in `src/ui/api/fleet-status-types.ts` for accuracy and documentation parity. Also add `dormant?: boolean | null` to close the Phase 52 gap while the file is open.

---

## Code Examples

### The `.recycled-at` lifecycle (agent-supervisor) [VERIFIED: codebase]

```bash
# Line 985: rename sentinel → .recycled-at at recycle start (before old claude dies)
mv "$sentinel" "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null || rm -f "$sentinel"

# Line 475: 8s delayed removal after fresh claude is up (Path A - normal recycle)
( sleep 8; rm -f "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null ) & disown

# Line 530: 8s delayed removal (Path B - FORCE_FRESH recycle, session was already gone)
if [ -f "$IDENTITIES_DIR/$name/.recycled-at" ]; then
  ( sleep 8; rm -f "$IDENTITIES_DIR/$name/.recycled-at" 2>/dev/null ) & disown
fi
```

**Key timing:** The sentinel exists from before the old process dies through 8s after the fresh
claude finishes its `/id` load. The poller (2s cadence) will see the sentinel for multiple ticks.

### Dormant sentinel stat in orchestrator — exact pattern to clone [VERIFIED: codebase]

```typescript
// Lines 750–766 of ssh-poll-orchestrator.ts
let derivedDormant: boolean = cached?.dormant ?? false;
if (tmuxSession !== null) {
  const quotedTmuxSession = shellSingleQuote(tmuxSession);
  const dormantRaw = await channel.exec(
    `stat ~/.claude/identities/${quotedTmuxSession}/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
  );
  if (dormantRaw !== null) {
    const trimmed = dormantRaw.trim();
    if (trimmed === "yes") {
      derivedDormant = true;
    } else if (trimmed === "no") {
      derivedDormant = false;
    }
    // Anything else → fail-open, keep cached value
  }
  // dormantRaw === null → SSH hiccup → keep cached value (fail-open)
}
```

**Phase 53 recycling variant:**
```typescript
let derivedRecycling: boolean = cached?.recycling ?? false;
if (tmuxSession !== null) {
  const quotedTmuxSession = shellSingleQuote(tmuxSession);
  const recyclingRaw = await channel.exec(
    `stat ~/.claude/identities/${quotedTmuxSession}/.recycled-at 2>/dev/null >/dev/null && echo yes || echo no`,
  );
  if (recyclingRaw !== null) {
    const trimmed = recyclingRaw.trim();
    if (trimmed === "yes") {
      derivedRecycling = true;
    } else if (trimmed === "no") {
      derivedRecycling = false;
    }
  }
}
```

### Fingerprint extension (existing line 425) [VERIFIED: codebase]

```typescript
// Current:
return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}`;

// Phase 53 extension — append recycling segment:
return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}`;
```

### Working-store Axis D (dormant) — exact pattern for Axis E (recycling) [VERIFIED: codebase]

```typescript
// Axis D block, lines 238–266 of session-working-store.ts
if (state_arg.dormant !== undefined) {
  const dormant = state_arg.dormant === true;
  const existingAfterAxes = state.map.get(key);
  if (
    existingAfterAxes !== undefined &&
    existingAfterAxes.dormant !== dormant
  ) {
    const nextMap = new Map(state.map);
    nextMap.set(key, {
      isWorking: existingAfterAxes.isWorking,
      lastMessageAt: existingAfterAxes.lastMessageAt,
      aiTitle: existingAfterAxes.aiTitle,
      dormant,
    });
    state = { map: nextMap };
    notify();
  }
}

// Phase 53 Axis E (recycling) — clone Axis D, substitute recycling:
if (state_arg.recycling !== undefined) {
  const recycling = state_arg.recycling === true;
  const existingAfterAxes = state.map.get(key);
  if (
    existingAfterAxes !== undefined &&
    existingAfterAxes.recycling !== recycling
  ) {
    const nextMap = new Map(state.map);
    nextMap.set(key, {
      isWorking: existingAfterAxes.isWorking,
      lastMessageAt: existingAfterAxes.lastMessageAt,
      aiTitle: existingAfterAxes.aiTitle,
      dormant: existingAfterAxes.dormant,
      recycling,
    });
    state = { map: nextMap };
    notify();
  }
}
```

### Working-store hook (clone of useSessionIsDormant) [VERIFIED: codebase]

```typescript
// Lines 527–535 of session-working-store.ts — useSessionIsDormant:
export function useSessionIsDormant(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.dormant;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Phase 53 clone — useSessionIsRecycling:
export function useSessionIsRecycling(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.recycling;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

### PrettyView.tsx — old effect to remove and new hook to add [VERIFIED: codebase]

```typescript
// REMOVE (lines 2422–2425):
useEffect(() => {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  publishSessionRecycling(key, renderedState === "holding");
}, [renderedState, hostId, tmuxSession]);

// REMOVE import (line 58):
import { publishSessionRecycling } from "@/state/session-recycling-store";

// ADD near other working-store hook imports (lines 59–62):
import {
  useSessionIsWorking,
  useSessionIsWorkingRaw,
  useSessionIsRecycling,  // NEW
} from "@/state/session-working-store";

// ADD near the other hook calls in the component body (after line 62 region):
const sessionKey = hostId && tmuxSession ? `${hostId}:${tmuxSession}` : null;
const isRecycling = useSessionIsRecycling(sessionKey);

// SessionHoldingOverlay mount gate — wire to isRecycling:
// BEFORE:
{renderedState === "holding" && <SessionHoldingOverlay />}
// AFTER:
{isRecycling && <SessionHoldingOverlay />}
```

**IMPORTANT NUANCE:** PrettyView.tsx uses `renderedState === "holding"` in TWO more places
beyond the overlay mount gate: `isHolding={renderedState === "holding"}` at line 3105 and
`recycleActive={renderedState === "holding"}` at line 3109 for ComposeBox props. These are
ComposeBox behavioral controls (disable inputs during recycle) which can also switch to
`isRecycling` from the new store hook, since both sources now agree on the same signal.
The CONTEXT.md is unambiguous: the design goal is one source for both surfaces — the holding
overlay and the row spinner — so all three usages of `renderedState === "holding"` that
relate to recycling (overlay mount, isHolding, recycleActive) should switch to `isRecycling`.

### PrettyConversationsPanel.tsx — old hook to replace [VERIFIED: codebase]

```typescript
// REMOVE import (line 102):
import { useSessionRecycling } from "@/state/session-recycling-store";

// REMOVE hook call in PrettyConversationRowLive (line 219):
const isRecycling = useSessionRecycling(sessionKey);

// ADD to working-store import (extend the existing import block at line 101):
import {
  useSessionIsWorking,
  useSessionIsDormant,
  useSessionAiTitle,
  useSessionIsRecycling,  // NEW
} from "@/state/session-working-store";

// REPLACE in PrettyConversationRowLive:
const isRecycling = useSessionIsRecycling(sessionKey);
```

The `isRecycling === true` coercion at the `PrettyConversationRow` prop site (line 238)
becomes `isRecycling` (already boolean from the new hook, no coercion needed — or keep
`isRecycling === true` for symmetry; both are fine).

---

## Runtime State Inventory

Not a rename/refactor/migration phase. No runtime state is renamed. The `.recycled-at`
sentinel is read-only from Skynet's perspective; the supervisor manages its lifecycle.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PrettyView publishes to session-recycling-store on `renderedState === "holding"` change | ssh-poll reads sentinel on managed box; working-store axis consumed by both surfaces | Phase 53 | Unmounted rows now see recycling state; both surfaces agree |
| `useSessionRecycling` (session-recycling-store.ts) | `useSessionIsRecycling` (session-working-store.ts) | Phase 53 | Store retired; one fewer module |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No source B enumeration needed for recycling (live-PID coverage sufficient) | Architecture | If recycling fires while no PID exists on disk, the poller misses the sentinel. Risk is LOW — the `.recycled-at` sentinel is placed before the old process is killed (a live claude PID exists at sentinel placement) and held for 8s after the fresh one is up. The 2s poller sees both the outgoing and incoming PID during this window. | [ASSUMED] |
| A2 | `fleet-status-types.ts` `SessionState.dormant` gap from Phase 52 is benign because `strict: false` | Pitfall 7 | Confirmed benign for compilation; still a documentation gap to fix in this phase. | [VERIFIED: codebase, tsconfig.app.json] |

---

## Open Questions

1. **ComposeBox `isHolding` + `recycleActive` — wire to `isRecycling` or keep `renderedState === "holding"` for behavioral correctness?**
   - What we know: Both `isHolding` and `recycleActive` on ComposeBox currently derive from `renderedState === "holding"`. `renderedState` is driven by `pane_state` WS frames from the backend claude-session server (not the fleet-status poller). The fleet-status `recycling` axis is driven by the SSH poller reading `.recycled-at`.
   - What's unclear: There is a theoretical race — `renderedState === "holding"` can transition the moment the backend emits `pane_state`, while `recycling` from the working-store follows a 2s poll cadence. A recycle that starts and completes within a single 2s poll window might not generate a visible recycling=true frame at all.
   - Recommendation: Switch `isHolding` and `recycleActive` to use `isRecycling` from the new store hook — the CONTEXT.md explicitly states "one source of truth for both surfaces." The 2s poll cadence is fast enough for the holding window (which is 8s minimum). However, this is a nuance the planner should flag to Ashley if there is any risk that ComposeBox behavioral disable could be missed.

2. **Do the `sessionKey` key computation and `hostId` props already exist in PrettyView.tsx at the overlay mount site?**
   - What we know: PrettyView already computes `const key = \`${hostId}:${tmuxSession ?? ""}\`` for the now-removed `publishSessionRecycling` effect (line 2423). The `hostId` and `tmuxSession` props are well-established in PrettyView.
   - What's unclear: Whether there's an existing `sessionKey` constant in scope near the overlay render site, or whether the key needs to be derived inline.
   - Recommendation: Check whether the existing key-construction at line 2423 can be lifted to a `useMemo` or `const` outside the effect, and reuse it for the hook call. This is a minor implementation detail for the planner to specify.

---

## Environment Availability

Step 2.6: SKIPPED — no new external dependencies. All changes are SSH exec pattern (existing
infrastructure), working-store axis (existing module), and file import swaps.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed running) |
| Config file | `vite.config.ts` (project root) |
| Quick run command | `npx vitest run src/ui/state/session-working-store src/backend/fleet-status/ssh-poll-orchestrator` |
| Full suite command | `npx vitest run src/backend/fleet-status src/ui/state` |

### Phase Requirements → Test Map

| Behavior | Test Type | Automated Command | Notes |
|----------|-----------|-------------------|-------|
| Wire schema accepts `recycling?: boolean \| null` | unit | `npx vitest run src/backend/fleet-status/wire-protocol` | Extend existing schema tests |
| `computeFingerprint` includes recycling axis | unit | `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator` | New describe block mirroring Phase 52 dormant tests |
| ssh-poll source A stats `.recycled-at` per PID-tick | unit | same | 5 cases: yes, no, null(fail-open), same-value-suppress, changed-value-publish |
| `publishFleetStatusSessionState` stores recycling on Axis E | unit | `npx vitest run src/ui/state/session-working-store` | 7 cases mirroring P52-01-i…vii |
| `useSessionIsRecycling` returns correct boolean | unit | same | Included in working-store tests |
| Axis A republish preserves cached recycling value | unit | same | Key correctness test |
| PrettyConversationsPanel uses new hook | smoke | `npx tsc --noEmit` | Import swap only; no new behavior to unit-test |
| PrettyView overlay uses new hook | smoke | `npx tsc --noEmit` | Import swap + effect removal |
| session-recycling-store deleted, no dangling imports | build | `npx tsc --noEmit && npm run build` | Full build proves retirement complete |

### Wave 0 Gaps

- No new test FILES needed — extend existing test files in place:
  - `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — add recycling describe block
  - `src/ui/state/session-working-store.test.ts` — add Axis E describe block
- `src/ui/state/session-recycling-store.test.ts` — DELETE (along with the store)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `stat` stdout trimmed + compared against fixed literals `"yes"`/`"no"` only; anything else falls through to fail-open. Same T-52-01-01 pattern. |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crafted `.recycled-at` stat stdout from compromised host | Tampering | Trim + fixed-string compare (`"yes"`/`"no"` only); fail-open on anything else — cannot force recycling=true via stdout injection |
| Shell injection via tmuxSession in stat command | Tampering | `shellSingleQuote(tmuxSession)` — same mitigation as T-52-01-02 already applied to the `.dormant` stat |
| Wire field visible in browser dev tools | Information Disclosure | Boolean leaks only "identity is currently being recycled" — same information already observable via session-recycling-store; no new exposure |

---

## Sources

### Primary (HIGH confidence)
- `~/.local/bin/agent-supervisor` lines 444–531, 972–993 — exact sentinel lifecycle: placement, path B, delayed removal [VERIFIED: codebase]
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` lines 729–966 — dormant sentinel stat pattern + fingerprint + cache + SessionState composition [VERIFIED: codebase]
- `src/backend/fleet-status/wire-protocol.ts` lines 128–174 — dormant field addition pattern, additive-optional convention, FRAME_SCHEMA_VERSION invariant [VERIFIED: codebase]
- `src/ui/state/session-working-store.ts` lines 65–267, 527–535 — WorkingRecord shape, Axis D dormant block, useSessionIsDormant hook [VERIFIED: codebase]
- `src/ui/state/session-recycling-store.ts` — full file — the store to retire [VERIFIED: codebase]
- `src/ui/features/pretty-view/PrettyView.tsx` lines 58, 2415–2425, 2749, 3105–3109 — current recycling publish effect + overlay mount gate + ComposeBox props [VERIFIED: codebase]
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` lines 102, 213–243 — current `useSessionRecycling` consumption + `isRecycling` prop pass-through [VERIFIED: codebase]
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` lines 973–983 — `showSpinnerOn` predicate [VERIFIED: codebase]
- `.planning/phases/52-convo-list-filter-restyle-popover-add-ready-toggle/52-01-PLAN.md` — Phase 52 dormant axis plan, reference implementation [VERIFIED: codebase]
- `tsconfig.app.json` — `strict: false` (explains why fleet-status-types.ts gap is benign) [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- `src/ui/api/fleet-status-types.ts` — missing `dormant` field (Phase 52 gap); `pid: number` not nullable [VERIFIED: codebase — confirmed by grep]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all patterns directly verified in codebase
- Architecture: HIGH — direct code reading of every file in scope
- Pitfalls: HIGH — most derived from observed Phase 52 patterns and the CONTEXT.md scope constraints

**Research date:** 2026-08-21
**Valid until:** 2026-09-20 (stable codebase; patterns unlikely to change)

---

## Wave Structure Suggestion

### Wave 1 — Backend wire + store (can execute in parallel within Wave 1, file-disjoint)

**Plan 53-01:** Wire types + working-store Axis E
- `src/backend/fleet-status/wire-protocol.ts` — add `recycling?: z.boolean().nullable().optional()`
- `src/ui/api/fleet-status-types.ts` — add `recycling?: boolean | null`; also add `dormant?: boolean | null` (Phase 52 gap); relax `pid` to `number | null` for mirror accuracy
- `src/ui/state/session-working-store.ts` — add `recycling: boolean` to `WorkingRecord`; Axis E block in `publishFleetStatusSessionState`; preserve recycling in Axis A; `useSessionIsRecycling` hook; test coverage (Axis E describe block mirroring P52-01-i…vii)

**Plan 53-02:** SSH poller source A
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — add `recycling: boolean` to `PidCacheEntry`; stat `.recycled-at` in `processPid` after dormant stat; stamp `SessionState.recycling`; extend `computeFingerprint`; cache writeback; test coverage (5 cases mirroring Phase 52 Task 2 tests)

These two plans are file-disjoint and can be assigned to the same wave.

### Wave 2 — Consumer swap + retirement (serial: depends on Wave 1 hooks being available)

**Plan 53-03:** Consumer rewires + store retirement
- `src/ui/features/pretty-view/PrettyView.tsx` — remove `publishSessionRecycling` import + useEffect; add `useSessionIsRecycling` hook call; wire to overlay mount gate + `isHolding` + `recycleActive` props
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — swap `useSessionRecycling` import to `useSessionIsRecycling` from working-store
- DELETE `src/ui/state/session-recycling-store.ts`
- DELETE `src/ui/state/session-recycling-store.test.ts`
- Verify: `npx tsc --noEmit` clean + full build green + no imports of session-recycling-store in `src/`
