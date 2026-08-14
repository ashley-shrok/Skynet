# Phase 41: Defer Terminal View Mount Until User Summons It — Research

**Researched:** 2026-08-14
**Domain:** React pane restructure, fleet-status broadcast extension, tab-title re-sourcing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Load behavior — cold-every-time**
- Terminal component does not mount when a session opens (identity-based sessions only).
- First press of Ctrl+Shift+O or long-press-identity-badge triggers cold-boot: fresh Terminal mount, fresh xterm instance, fresh SSH WebSocket dial, backend tmux reattach.
- Toggle back to PrettyView tears Terminal down completely — unmount component, close WebSocket, destroy xterm. Every visit is a fresh cold-boot.
- No "keep warm" mode. No opt-out toggle. No feature flag. If cold-boot feels slow, make cold-boot faster — not warm-keep.
- Reuse existing terminal "Connecting…" UX for the cold-boot moment. Do NOT design a new loading state.

**Pane restructure — PrettyView promoted, Terminal becomes dormant peer**
- PrettyView and Terminal become independent siblings under a new pane wrapper component.
- State currently owned by TerminalInner that must survive Terminal being unmounted is hoisted OUT to the new pane wrapper: `isPrettyMode`, `togglePrettyMode` imperative ref, `pvSendInputRef`, `pvSendInterruptRef`.
- The wrapper owns the mount decision — Terminal mounts iff `isPrettyMode === false`. Toggle flips `isPrettyMode`, which mounts/unmounts Terminal as a side effect of the render.
- Ctrl+Shift+O keyboard handler and long-press-identity-badge handler both drive the wrapper's `isPrettyMode` state (no change to their user-facing behavior; just a different state target).
- Terminal's imperative-handle contract (currently exposing `togglePrettyMode`) is replaced/re-hosted so AppShell's `terminalRefs.get(id).current?.togglePrettyMode?.()` still works. Ref may now point at the wrapper instead of Terminal.

**isIdle re-sourcing**
- PrettyView reads isIdle from the fleet-status backend broadcast (Phase 39 mechanism) instead of Terminal's SSH-WS-derived signal. The broadcast already carries `isWorking` per session (post-patch #442 composite).
- Slight lag from broadcast poll cadence vs. real-time WS frames is accepted.
- Graceful degradation — if the broadcast has never delivered isIdle for a session yet (fresh session, first poll hasn't landed), the WIP indicator + ready-dot are ABSENT (not stuck-on).

**Tab title re-sourcing**
- Extend the fleet-status backend broadcast payload to include `tmuxSessionName` per session.
- Backend fills tmuxSessionName from the same SSH poll that fills isWorking (single round-trip; do not add a second SSH call).
- AppShell / tab-title mechanism reads tmuxSessionName from the fleet-status broadcast instead of receiving it via Terminal's `onTmuxSessionChange` callback.
- Before the first broadcast lands for a fresh session, the tab title shows a sensible placeholder.

**Scope boundary**
- Deferred-mount applies ONLY to panes where PrettyView is the default landing view (identity-based agent sessions).
- Non-identity SSH terminal sessions render Terminal directly with no PrettyView — unaffected.
- RDP/Guacamole panes use a different render path entirely — unaffected.

**Send path**
- Phase 35 (patch #435) migrated the send path off borrowing Terminal's WebSocket. PrettyView owns `pvSendInputRef` / `pvSendInterruptRef` and dials its own claude-session WebSocket. No send-path work required in this phase — just ensure these refs are hoisted correctly.

### Claude's Discretion
- Exact name and location of the new pane wrapper component (naming, file placement).
- Exact mechanism for state hoisting (React composition patterns, prop drilling vs context).
- Exact wire-schema additions to fleet-status broadcast (property name, encoding).
- Placeholder-string content for tab title before first broadcast.
- Test structure (unit vs integration vs in-process), test file layout, mock strategies.

### Deferred Ideas (OUT OF SCOPE)
- Faster fleet-status poll cadence — deferred until user reports isIdle lag feels wrong.
- Cold-boot performance optimizations beyond what falls out naturally from the pane restructure.
- Any "keep this one warm" pin, escape hatch, or feature flag.
- Visible "deferred / cold" badge on the tab or pane.
- Rewriting PrettyView's own architecture beyond what's needed to stand alone.
- Migrating non-identity SSH terminal sessions to also gain a PrettyView surface.
</user_constraints>

---

## Summary

Phase 41 restructures the pane composition model so PrettyView and Terminal are independent siblings rather than PrettyView nesting inside Terminal. The current code is verified: PrettyView is rendered inside TerminalInner's JSX at L3308-3379, conditioned on `isPrettyMode && hostConfig.id != null && tmuxSessionName`. All toggle state (`isPrettyMode`), send refs (`pvSendInputRef`, `pvSendInterruptRef`), and the imperative handle (`togglePrettyMode`) are currently owned by TerminalInner and will be hoisted to a new `IdentitySessionPane` wrapper in `tabUtils.tsx`.

Two signal re-sourcings are required so PrettyView can stand alone without a mounted Terminal:

1. **isIdle** — PrettyView uses `isIdle` prop for the aside-arm trigger (Phase 14) and passes it to ComposeBox for the idle-send queue gate. The fleet-status broadcast already delivers `status` per session via `useSessionIsWorking` + `session-working-store`. The `isIdle` derivation (`!isWorking`, from the broadcast) can be computed inside PrettyView itself from the same store, removing the prop entirely.

2. **Tab title (tmuxSessionName)** — AppShell's `tmuxSessionNames` record is populated today via Terminal's `onTmuxSessionChange` callback. The fleet-status broadcast's `SessionState` already carries `tmuxSession: string | null` in its wire format — this field is already present in both the backend `wire-protocol.ts` and the frontend `fleet-status-types.ts`. No wire-format extension is needed. The only work is adding a new store (`session-tmux-store.ts`) that AppShell's fleet-status `onUpdate`/`onSnapshot` callbacks populate, and replacing the `tmuxSessionNames[tabId]` read in AppShell with a lookup into that store keyed by `hostId:tmuxSession`.

**Primary recommendation:** Land P2 (broadcast read-paths) before P1 (Terminal-signal removals). Shipping P2 first lets PrettyView read isIdle and tmux-session-name from the broadcast AND continue to receive the Terminal prop as a fallback. P1 then removes the now-redundant fallback paths and restructures the pane. This ordering means the intermediate state between commits is never broken for the user.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `isPrettyMode` toggle state | New pane wrapper (tabUtils) | — | Must survive Terminal unmount; AppShell Ctrl+Shift+O calls through wrapper ref |
| `pvSendInputRef` / `pvSendInterruptRef` | New pane wrapper | — | PrettyView registers these; MessageQueueDrawer reads them; neither depends on Terminal being mounted |
| Terminal mount decision | New pane wrapper | — | Wrapper renders `<Terminal>` only when `!isPrettyMode && isIdentitySession` |
| isIdle (WipBubble + aside-arm) | Fleet-status broadcast store | (was: Terminal SSH-WS) | Broadcast already delivers `status` per session; `isIdle = !isWorking` |
| Tab title (tmuxSessionName) | Fleet-status broadcast store | (was: Terminal `onTmuxSessionChange` callback) | `SessionState.tmuxSession` already on the wire; needs a new store + AppShell read |
| Scope-boundary detection (identity vs terminal-only vs RDP) | `TerminalTabContent` (tabUtils) | — | The "does this pane have a PrettyView?" branch is already implicit in Terminal.tsx's `hasAutoActivatedPrettyRef` logic; wrapper must replicate it |
| AppShell toggle dispatch | AppShell `useKeyboardTogglePrettyMode` | — | No behavioral change; just retargets the ref to point at wrapper |
| Backend SSH poll + SessionState broadcast | SSH-poll orchestrator | — | Already polls every 2s; `tmuxSession` field already populated and broadcast |

---

## Standard Stack

No new external packages are introduced by this phase. The phase touches existing first-party modules only.

### Core (existing, touched by this phase)

| Module | File | Role in Phase |
|--------|------|--------------|
| TerminalInner / Terminal | `src/ui/features/terminal/Terminal.tsx` | Source of state to hoist; PrettyView removed from its JSX |
| TerminalTabContent / renderTabContent | `src/ui/shell/tabUtils.tsx` | Site for new `IdentitySessionPane` wrapper |
| PrettyView | `src/ui/features/pretty-view/PrettyView.tsx` | isIdle prop dropped; reads from store; gains standalone mount path |
| AppShell | `src/ui/AppShell.tsx` | `tmuxSessionNames` state replaced by store read; fleet-status callbacks extended |
| `session-working-store.ts` | `src/ui/state/session-working-store.ts` | `isIdle = !useSessionIsWorking(key)` derivation already possible |
| `fleet-status-client.ts` | `src/ui/api/fleet-status-client.ts` | `onSnapshot`/`onUpdate` callbacks extended to also publish to new tmux-name store |
| `fleet-status-types.ts` | `src/ui/api/fleet-status-types.ts` | `SessionState.tmuxSession` already present; no change needed |
| `wire-protocol.ts` | `src/backend/fleet-status/wire-protocol.ts` | `SessionState.tmuxSession` already in schema; no wire change needed |

### New module (Claude's discretion)

| Module | File | Role |
|--------|------|------|
| `session-tmux-store.ts` | `src/ui/state/session-tmux-store.ts` (suggested) | Per-`hostId:tmuxSession` → identity-name lookup; mirrors `session-working-store.ts` pattern |

### Package Legitimacy Audit

No external packages are installed by this phase. Audit not applicable.

---

## Architecture Patterns

### System Architecture Diagram — Current (pre-Phase-41)

```
AppShell
  └─ tabUtils.renderTabContent() → TerminalTabContent
       └─ <Terminal ref={tab.terminalRef}>   ← holds ALL state
            ├─ isPrettyMode (state)
            ├─ pvSendInputRef (ref)
            ├─ pvSendInterruptRef (ref)
            ├─ webSocketRef  (SSH WS)
            ├─ tmuxSessionName (state → onTmuxSessionChange callback)
            ├─ isIdle (state, from SSH-WS frames — NOW RETIRED per patch #442)
            ├─ useImperativeHandle → TerminalHandle { togglePrettyMode }
            └─ JSX:
                 ├─ <xterm div> (hidden when isPrettyMode)
                 └─ {isPrettyMode && <PrettyView isIdle={isIdle} ...>}
                                        └─ reads isIdle as prop
                                        └─ isWorking from session-working-store (fleet-status)
```

```
AppShell.useKeyboardTogglePrettyMode(id)
  └─ terminalRefs.current.get(id).current?.togglePrettyMode?.()
       └─ calls TerminalInner.setIsPrettyMode((v) => !v)
```

```
AppShell fleet-status client (boot-time WS)
  └─ onSnapshot/onUpdate → publishFleetStatusSessionState(hostId, state)
       └─ session-working-store: key=`${hostId}:${tmuxSession}` → isWorking

PrettyView
  └─ useSessionIsWorking(sessionWorkingKey) → isWorking (for WipBubble)
  └─ isIdle prop (from Terminal) → aside-arm trigger + ComposeBox idle-send gate
                                    [THIS IS WHAT GETS RE-SOURCED]
```

### System Architecture Diagram — Post-Phase-41

```
AppShell
  └─ tabUtils.renderTabContent() → IdentitySessionPane  ← NEW wrapper
       ├─ isPrettyMode (hoisted state)
       ├─ pvSendInputRef (hoisted ref)
       ├─ pvSendInterruptRef (hoisted ref)
       ├─ isIdentitySession (computed from tab/host)
       ├─ forwardRef → wrapper exposes TerminalHandle.togglePrettyMode
       ├─ <PrettyView ...>   (always mounted when isIdentitySession)
       │    └─ isIdle derived internally: !useSessionIsWorking(key)
       └─ {!isPrettyMode && <Terminal ref=... onTmuxSessionChange=...>}
                                 (conditionally mounted; cold-boots on toggle)

AppShell.useKeyboardTogglePrettyMode(id)
  └─ terminalRefs.current.get(id).current?.togglePrettyMode?.()
       └─ calls IdentitySessionPane.setIsPrettyMode((v) => !v)   ← retargeted

AppShell fleet-status client (boot-time WS)
  └─ onSnapshot/onUpdate:
       ├─ publishFleetStatusSessionState(hostId, state) → session-working-store
       └─ publishFleetStatusTmuxSession(hostId, state)  → session-tmux-store [NEW]

AppShell document.title effect
  └─ reads from session-tmux-store instead of tmuxSessionNames[activeTabId]
```

Non-identity terminal sessions (`TerminalTabContent` when not an identity session): unchanged — render `<Terminal>` directly, no wrapper.

RDP/Guacamole sessions: unchanged — `<GuacamoleApp>`.

### Recommended Project Structure (additions only)

```
src/ui/
├─ state/
│   └─ session-tmux-store.ts    # NEW — per-session tmuxSession name, mirrors session-working-store.ts pattern
├─ shell/
│   └─ tabUtils.tsx             # MODIFY — add IdentitySessionPane wrapper component
└─ features/
    ├─ terminal/
    │   └─ Terminal.tsx          # MODIFY — remove PrettyView render from JSX; remove isPrettyMode state; remove pvSend* refs
    └─ pretty-view/
        └─ PrettyView.tsx        # MODIFY — drop isIdle prop; derive internally from session-working-store
```

### Pattern 1: State hoisting via wrapper component with forwardRef

The new `IdentitySessionPane` wrapper component in `tabUtils.tsx` hoists `isPrettyMode`, `pvSendInputRef`, and `pvSendInterruptRef` from TerminalInner into itself. AppShell's `terminalRefs` map continues to point at this wrapper via `forwardRef`; the wrapper exposes a `TerminalHandle`-compatible imperative handle so `terminalRefs.current.get(id).current?.togglePrettyMode?.()` continues to work without any changes to AppShell's dispatch path.

```typescript
// Source: established pattern from Terminal.tsx L1035 (useImperativeHandle) — same shape
const IdentitySessionPane = forwardRef<TerminalHandle, IdentitySessionPaneProps>(
  function IdentitySessionPane({ tab, host, isVisible, attach, ... }, ref) {
    const [isPrettyMode, setIsPrettyMode] = useState(true); // default: PrettyView open
    const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null);
    const pvSendInterruptRef = useRef<(() => void) | null>(null);

    useImperativeHandle(ref, () => ({
      togglePrettyMode: () => setIsPrettyMode((v) => !v),
      toggleMessageQueue: () => { /* forward to terminal ref when mounted */ },
      // ... other TerminalHandle methods forwarded to inner terminal ref
    }), []);

    return (
      <>
        <PrettyView
          hostId={host.id}
          tmuxSession={/* from session-tmux-store, or tab.targetTmuxSession as seed */}
          isVisible={isVisible}
          onTogglePrettyMode={() => setIsPrettyMode((v) => !v)}
          onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}
          onRegisterSendInterrupt={(fn) => { pvSendInterruptRef.current = fn; }}
          onUnregisterSendInput={() => { pvSendInputRef.current = null; }}
          onUnregisterSendInterrupt={() => { pvSendInterruptRef.current = null; }}
          // isIdle prop REMOVED — PrettyView now reads from fleet-status store internally
        />
        {!isPrettyMode && (
          <Terminal
            ref={innerTerminalRef}
            hostConfig={...}
            onTmuxSessionChange={...} // still fires; used for session-tmux-store key resolution
            ...
          />
        )}
      </>
    );
  }
);
```

### Pattern 2: isIdle derivation inside PrettyView from fleet-status store

`isIdle` in PrettyView is currently a prop (`boolean | null`). After re-sourcing, PrettyView computes it internally:

```typescript
// Source: session-working-store.ts — useSessionIsWorking already implemented
const sessionWorkingKey = `${hostId}:${tmuxSession ?? ""}`;
const isWorking = useSessionIsWorking(sessionWorkingKey); // boolean
// isIdle = !isWorking when the store has published for this key;
// but we need the three-state semantics: null = "never published yet"
// The store returns `false` for unknown keys — this collapses null into false.
// To preserve the null="absent, don't show WIP" semantics:
// check whether the key exists in the store's map before computing isIdle.
const isWorkingRaw = useSessionIsWorkingRaw(sessionWorkingKey); // boolean | null
// "Raw" variant: returns null if key has never been published, false if key published+idle, true if working
```

**Important:** The current `useSessionIsWorking` returns `false` for unknown keys (never-published sessions). This collapses the three states into two: `true` (working) vs `false` (idle or unknown). For the `isIdle` aside-arm trigger, the distinction between "never heard" (null) and "heard, idle" (false → isIdle true) matters — the aside-arm only fires on a real false→true transition, not on initial mount with null. This means either:

(a) `session-working-store` needs a companion export `useSessionIsWorkingKnown(): boolean | null` — `null` when key absent, `false` when idle, `true` when working; or  
(b) PrettyView uses `useSessionIsWorking` for WipBubble (existing behavior unchanged) and introduces a separate `hasReceivedFirstBroadcast` flag (seeded false, set true on first store publish for this key) to gate the aside-arm trigger.

Option (a) is simpler and consistent with how the code comments describe intent. The planner should choose one — this is Claude's discretion.

The `WipBubble` is driven by `isWorking` from the store today and is **unchanged** — it already reads from fleet-status broadcast. No work needed there.

### Pattern 3: session-tmux-store — new store, mirrors session-working-store pattern

```typescript
// Source: session-working-store.ts — mirrors the module-scoped Map + listener pattern exactly
// Key: `${hostId}:${tmuxSession}` (same convention as session-working-store)
// Value: { tmuxSession: string } — the tmux session name for this (hostId, sessionId) pair
// Written when: AppShell's fleet-status onUpdate/onSnapshot fires
// Read by: AppShell's document.title effect (replaces tmuxSessionNames[activeTabId] lookup)
```

The key insight: `SessionState` already carries `tmuxSession: string | null` in the broadcast payload (verified in `fleet-status-types.ts` L90 and `wire-protocol.ts` L85). **No backend changes are required for tab-title re-sourcing.** The `tmuxSession` name is already on the wire.

The only challenge: AppShell's current `tmuxSessionNames` record is keyed by `tabId` (the React tab ID), while the fleet-status store is keyed by `hostId:tmuxSession`. AppShell needs a mapping from `(hostId, tmuxSession)` → `tabId` to update the store correctly. Alternatively, the new store is keyed by `(hostId, tmuxSession)` and AppShell's document.title effect queries the store using the active tab's `hostId` + the previously-known `tmuxSession` (from a fallback path during transition).

**Simpler approach:** AppShell adds a new `Map<tabId, tmuxSession>` state slot that is populated both from Terminal's `onTmuxSessionChange` callback (existing) AND from the fleet-status broadcast (new). The broadcast path populates it when `state.tmuxSession` is non-null and the `tabId` can be resolved by matching `state.hostId` against the tab's `host.id`. This avoids a new store entirely. Keying is: `tabs.find(t => String(t.host?.id) === state.hostId && /* tmux matches */)?.id`.

Actually, the cleanest path: keep `tmuxSessionNames` in AppShell but add a second feeder alongside Terminal's callback. The fleet-status `onUpdate`/`onSnapshot` callbacks in AppShell also call `setTmuxSessionNames` when `state.tmuxSession` is non-null, matched to the relevant tab. This is additive and backward-compatible.

### Anti-Patterns to Avoid

- **Keeping PrettyView inside Terminal's JSX while trying to hoist state**: the restructure is atomic — either PrettyView is a sibling of Terminal under the wrapper, or it's inside Terminal. Do not attempt a hybrid.
- **Hoisting `webSocketRef` (the SSH WS) to the wrapper**: the SSH WebSocket belongs to Terminal. PrettyView's own claude-session WS belongs to PrettyView. Neither needs to move — Phase 35 already separated these.
- **Re-adding a `terminalWs` prop to PrettyView after the pane restructure**: Phase 35 removed the SSH-WS dependency from PrettyView's send path. The `terminalWs` prop on PrettyView is for file uploads only (upload events travel over the SSH WS). After the restructure, the wrapper can pass the Terminal's webSocketRef.current to PrettyView when Terminal is mounted, or set it null when Terminal is unmounted. The upload chip strip may become non-functional when Terminal is unmounted — this is acceptable (and correct) since you can't upload to a disconnected session.
- **Deriving `isPrettyMode` default from `identityKey` lookup inside the wrapper**: the auto-activate logic (currently in Terminal.tsx L334-340 — fires once when `identityKey` resolves) should become the default initial state of the wrapper: `useState(true)` (PrettyView open by default for identity sessions). The wrapper does not need to detect the identity at all — it only wraps identity-session tabs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| isWorking / isIdle signal for PrettyView | Custom WS frame parser, new backend endpoint | `useSessionIsWorking(key)` from `session-working-store.ts` | Already exists; fleet-status broadcast already feeds it |
| tmux session name for AppShell | New SSH call, new backend endpoint | Extend AppShell's fleet-status `onUpdate`/`onSnapshot` to also call `setTmuxSessionNames` | `SessionState.tmuxSession` is already on the wire — no backend change needed |
| Imperative toggle dispatch from AppShell | New React context, event bus | `forwardRef` + `useImperativeHandle` on wrapper | Already the established pattern; zero AppShell dispatch code changes |
| WS cleanup on Terminal unmount | Manual timer/WS teardown in wrapper | React's standard component lifecycle — unmounting Terminal cleans up its own `useEffect` returns | Terminal already handles all its cleanup via `useEffect` return callbacks; unmount fires them automatically |

**Key insight:** The `tmuxSession` field is already in the fleet-status `SessionState` broadcast payload on both backend and frontend types. There is NO wire-format change required. The CONTEXT.md says "extend the broadcast payload to include `tmuxSessionName`" — this was written before the researcher verified the current wire format. The field is already there.

---

## Detailed Findings by Research Topic

### 1. Current Pane Arrangement (VERIFIED by source read)

**PrettyView is rendered inside TerminalInner's JSX.** Confirmed at `Terminal.tsx` L3308-3379:

```typescript
// Terminal.tsx ~L3308
{isPrettyMode && hostConfig.id != null && tmuxSessionName && (
  <PrettyView
    hostId={hostConfig.id}
    tmuxSession={tmuxSessionName}
    isIdle={isIdle}
    onTogglePrettyMode={() => setIsPrettyMode((v) => !v)}
    onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}
    onRegisterSendInterrupt={(fn) => { pvSendInterruptRef.current = fn; }}
    onUnregisterSendInput={() => { pvSendInputRef.current = null; }}
    onUnregisterSendInterrupt={() => { pvSendInterruptRef.current = null; }}
    ...
  />
)}
```

**State inventory — everything that must be hoisted to the wrapper:**

| Slot | Type | Current Owner | Reason to Hoist |
|------|------|--------------|-----------------|
| `isPrettyMode` | `useState<boolean>` (L274) | TerminalInner | Must survive Terminal unmount |
| `pvSendInputRef` | `useRef<fn \| null>` (L181) | TerminalInner | PrettyView registers; MessageQueueDrawer reads |
| `pvSendInterruptRef` | `useRef<fn \| null>` (L182) | TerminalInner | Same as above |
| `useImperativeHandle.togglePrettyMode` (L1134) | TerminalInner | Exposed via `TerminalHandle`; AppShell calls it |

**State that stays in Terminal (does NOT move to wrapper):**

| Slot | Why it stays |
|------|-------------|
| `webSocketRef` (L175) | SSH WS is Terminal-owned; dies with Terminal; PrettyView has its own WS |
| `isIdle` (L289) | Being re-sourced; Terminal's copy becomes irrelevant after Phase 41 |
| `tmuxSessionName` / `tmuxSessionNameRef` (L271-272) | Terminal still discovers this via SSH WS; it fires `onTmuxSessionChange` callback which feeds the store |
| `hasAutoActivatedPrettyRef` (L283) | Auto-activate logic moves to wrapper's default state (`useState(true)`) |
| All WS/xterm/connection state | Terminal-internal; unmount cleanup handles these |

**Auto-activate logic:** Terminal currently auto-activates pretty mode at L334-340 when `identityKey` resolves from the `identitiesByKey` store. After the restructure, the wrapper simply initializes `isPrettyMode = true` by default for identity-session panes. The "auto-activate" behavior is replaced by "starts in pretty-mode by design."

**TerminalHandle contract (terminal-types.ts L20-29):**

```typescript
export interface TerminalHandle {
  disconnect: () => void;
  reconnect: () => void;
  fit: () => void;
  sendInput: (data: string, messageQueueItemId?: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  toggleMessageQueue: () => void;
  togglePrettyMode: () => void;
}
```

The wrapper must expose at minimum `togglePrettyMode` (AppShell calls it) and `toggleMessageQueue` (AppShell calls it via `useKeyboardMessageQueue`). Other methods (`disconnect`, `reconnect`, `fit`, `sendInput`, `notifyResize`, `refresh`) can be forwarded to the inner Terminal ref when Terminal is mounted, or be safe-noops when Terminal is not mounted.

**Long-press-identity-badge toggle:** Currently in Terminal.tsx L3421:
```typescript
onLongPress={() => setIsPrettyMode((v) => !v)}
```
After restructure, this becomes `onLongPress={() => onTogglePrettyMode?.()}` where `onTogglePrettyMode` is a prop from the wrapper, same as the existing `onTogglePrettyMode` prop already threaded to PrettyView at L3377.

### 2. Fleet-Status Broadcast — Current Wire Schema (VERIFIED)

The backend `SessionState` (from `wire-protocol.ts`) carries:

```typescript
{
  hostId: string;
  tmuxSession: string | null;    // ← ALREADY PRESENT
  sessionId: string;
  pid: number;
  status: "busy" | "shell" | "idle" | "waiting";
  waitingFor?: string;
  backgroundTasks: BackgroundTask[];
  updatedAt: number;
}
```

The frontend `SessionState` mirror (`fleet-status-types.ts`) matches identically. **`tmuxSession` is already broadcast per-session.** No backend wire-format change is needed for the tab-title re-sourcing.

**Where `tmuxSession` originates in the backend:** `ssh-poll-orchestrator.ts` resolves it via `resolvePidToTmuxSession()` during the SSH poll (L264-276). Resolution happens only for new PIDs or PIDs where `cached?.tmuxSession === null`. The resolved name is stored in `livenessMap` and included in every subsequent `SessionState` publish for that PID.

**CONTEXT.md said "extend the broadcast payload"** — this was written without knowing the field already exists. **No backend change is needed.**

### 3. PrettyView isIdle Consumption (VERIFIED)

**Current state:**
- `isIdle` is a prop to PrettyView (`boolean | null`, L135).
- It is passed from Terminal at L3314: `isIdle={isIdle}`.
- Terminal's `isIdle` state (L289) is populated... but read the comment at L290-295:

```typescript
// Phase 34 Plan 06: PTY-idle feeder useEffect RETIRED.
// The fleet-status channel (AppShell boot-time WS) now sources the
// working signal from the box-side ~/.claude/sessions/<pid>.json file
// via the backend SSH-poll orchestrator (Plan 04). PTY-scraping is no
// longer the primary signal. isIdle is preserved — other consumers in
// this file still use it (e.g. aside arm emitter, PTY diagnostics).
```

**Terminal's `isIdle` state is itself no longer updated by real-time WS frames as of Phase 34.** It is vestigial — initialized to `null` and never set to `true` or `false` via any active path. Terminal passes `null` to PrettyView for `isIdle` in practice.

**PrettyView's `isIdle` consumers:**
1. **Aside-arm trigger** (L1997): `if (prev === false && isIdle === true && pvIdentity != null)` — triggers `{type:"aside_arm"}` on PV WS. NOTE: aside auto-fire is currently DISABLED (L69-73 comment: "Ashley 2026-07-27: automatic aside triggering DISABLED"). The machinery exists but is not active.
2. **ComposeBox prop** (L2616): `isIdle={isIdle}` — ComposeBox uses it for idle-send queue dispatch gate.

**WipBubble** — driven by `isWorking` from `session-working-store` (L785), NOT by the `isIdle` prop. This is already re-sourced and working correctly.

**After Phase 41:** PrettyView can derive `isIdle` internally using `!useSessionIsWorking(key)` from the store, with a null-for-unknown-key guard. The aside-arm trigger will work correctly once the first broadcast lands (because the store will have a record for the key). The ComposeBox idle-send gate will also work correctly.

**Graceful degradation:** The store returns `false` for unknown keys (no record yet). `isIdle = !isWorking = !false = true` — this is wrong; it would cause the aside-arm to fire on first mount as a false transition. The correct fix: treat unknown-key as `isIdle = null` (same as current Terminal behavior where `isIdle` starts as `null` and is never updated). This requires the "raw" variant of the store hook.

### 4. AppShell Tab Title Mechanism (VERIFIED)

AppShell holds:
```typescript
const [tmuxSessionNames, setTmuxSessionNames] = useState<Record<string, string>>({});
```
Keyed by `tabId`. Populated via `handleTmuxSessionChange` callback (L426-438) which is called from Terminal's `onTmuxSessionChange` prop.

Document title effect (L466-479):
```typescript
const tmux = tmuxSessionNames[activeTabId];
const resolvedKey = (tmux ?? activeTab?.label ?? "").toLowerCase();
const identity = resolvedKey ? identitiesByKey.get(resolvedKey) : null;
document.title = identity?.displayName || tmux || activeTab?.label || "SKYNET";
```

The title falls back through: identity display name → raw tmux name → tab label → "SKYNET".

**After Phase 41:** When Terminal is not mounted, `onTmuxSessionChange` never fires. The `tmuxSessionNames[activeTabId]` entry is never populated. The fleet-status broadcast already carries `tmuxSession` — AppShell's `onUpdate`/`onSnapshot` callbacks can additionally call `setTmuxSessionNames` when `state.tmuxSession` is non-null. The matching from `state.hostId` to `tabId` uses: `tabs.find(t => String(t.host?.id) === state.hostId)?.id`. This may match multiple tabs on the same host; the correct one is identified by comparing `state.tmuxSession` against `tab.targetTmuxSession` (the tab's expected session name).

**Simpler matching approach:** Once Terminal mounts and fires `onTmuxSessionChange`, the tabId→tmuxSession mapping is established. The fleet-status broadcast then provides updates without Terminal being mounted. For the cold-boot phase (before first Terminal mount), the tab's `targetTmuxSession` prop (set when the tab was opened) gives the known session name and can pre-populate `tmuxSessionNames` at tab-open time.

**Timing of first title:** Before any broadcast lands, `tmuxSessionNames[activeTabId]` is `undefined`. The fallback chain resolves to `activeTab?.label` (the host name/session label set when the tab was opened). This is a "sensible placeholder" as the LOCKED decision accepts.

### 5. Pane Wrapper Restructure Surface (VERIFIED)

**`TerminalTabContent`** (tabUtils.tsx L90-139) is the current wrapper for `type === "terminal"` panes. It passes `hostConfig`, `isVisible`, `attach`, `onCloseTab`, `onTmuxSessionChange`, `onTmuxSessionMissing` to `<Terminal>`.

**How the ref is currently set:** AppShell `openTab()` at L1138-1139:
```typescript
const ref = type === "terminal" ? createRef() : undefined;
if (ref) terminalRefs.current.set(tabId, ref);
```
The ref is passed into `TerminalTabContent` as `tab.terminalRef` (L113):
```typescript
<TerminalFeature ref={tab.terminalRef as React.Ref<TerminalHandle>} ...>
```

**After restructure:** The new `IdentitySessionPane` wrapper is also a `forwardRef` component. `tab.terminalRef` is passed to it instead of to `<Terminal>`. The wrapper's `useImperativeHandle` exposes `togglePrettyMode` and `toggleMessageQueue`; other TerminalHandle methods are forwarded to the inner Terminal ref when mounted.

**Scope detection — how does the wrapper know it's an identity session?** Currently Terminal.tsx auto-detects via `identityKey = sessionMatchKey(tmuxSessionName)` and `identitiesByKey.has(identityKey)` (L334-340). The wrapper fires at tab-open time, before `tmuxSessionName` is known. Two approaches:

(a) The wrapper always renders PrettyView for all `type === "terminal"` panes with an identity hostId (i.e. hosts that have identity records). PrettyView's own phase machine handles the "no active session" state gracefully.  

(b) The tab's `targetTmuxSession` prop (set when the tab was opened from the conversation list / new-session dialog) tells the wrapper whether this is an identity-session tab. The `allowCreateTmux` flag also signals it was opened via the New Session dialog for an identity session.

**The cleaner approach (a):** `IdentitySessionPane` is created for all `type === "terminal"` tabs where `host.identityKey` is set or `tab.targetTmuxSession` matches a known identity. Non-identity SSH-terminal tabs continue using the existing `TerminalTabContent` path (no wrapper). The branch point stays in `renderTabContent`'s `case "terminal":` block.

**Existing pattern for forwardRef + imperative handle:** The entire `TerminalInner` / `Terminal` wrapping pattern (L3699-3707) is the precedent. The `ConnectionLogProvider` wrapper at L3702 shows how to nest forwardRef components.

### 6. Cold-Boot / Teardown Semantics (VERIFIED)

**Terminal unmount cleanup:** When React unmounts `<Terminal>`, all `useEffect` return callbacks fire. The critical ones:
- WS close: `webSocketRef.current?.close()` fires via the WS-setup effect's cleanup.
- Ping/pong timers: cleared via the `disconnect()` method (called from `useEffect` cleanup at L781).
- xterm: destroyed via `useXTerm()` hook's cleanup.

**Backend tmux session:** The SSH WebSocket closing does NOT tear down the tmux session on the backend. The tmux session on the box remains hot regardless of whether the frontend WS is connected. This is the established behavior — tmux sessions persist independently of the SSH WebSocket connection. Verified by the backend architecture: the WS is a proxy to the PTY; the PTY is inside tmux; closing the WS just detaches the PTY display without killing the session.

**On remount (cold-boot):** Fresh `<Terminal>` mounts. The xterm instance is freshly constructed. The SSH WS dials fresh. Backend receives a new connection and reattaches to the existing tmux session (or creates a new one per `allowCreateTmux`). The existing "Connecting…" UX fires (`isConnecting: true` state while WS handshake completes).

**Race condition on rapid toggle:** If the user toggles Terminal on and immediately off before the WS handshake completes, React unmounts Terminal before `onopen` fires. The WS `onerror` → `onclose` chain fires on the orphaned socket. `shouldNotReconnectRef.current` is set in the cleanup path (`disconnect()` via `useEffect` return), which prevents the reconnect retry loop from firing. This is already handled by the existing reconnect-guard logic.

**Double-mount risk:** React Strict Mode double-invokes effects in development. Terminal already handles this via `shouldNotReconnectRef` / `isUnmountingRef` guards. The wrapper adding an extra render level does not change this.

**isUnmountingRef:** This flag in TerminalInner (L363) guards against reconnect attempts after unmount. When Terminal unmounts due to `isPrettyMode=true`, this fires correctly because React's cleanup runs synchronously before the WS retry timeout could fire.

### 7. Scope-Boundary Detection (VERIFIED)

**Current mechanism:** The distinction between "identity session pane" and "terminal-only pane" is currently made inside Terminal.tsx via `identityKey = sessionMatchKey(tmuxSessionName)` after the SSH WS connects and `tmuxSessionName` is known. PrettyView is only rendered when `isPrettyMode && hostConfig.id != null && tmuxSessionName`.

**After Phase 41:** The wrapper must make this decision BEFORE Terminal mounts. Two signals available at tab-open time:

1. `tab.targetTmuxSession` — set when the tab is opened via the conversations panel or new-session dialog targeting a named identity tmux session. The session name (e.g. `"tina"`) matches an identity key.
2. `tab.allowCreateTmux` — true when opened via New Session dialog for an identity; false for restored/URL-opened tabs.

**Practical approach:** The `IdentitySessionPane` is inserted in `renderTabContent`'s `case "terminal":` only when the tab was opened for an identity session. The existing `case "terminal":` already calls `TerminalTabContent` — a new branch replaces this:

```typescript
case "terminal":
  if (!host) return <EmptyState .../>;
  // Is this an identity session pane? Check if the target tmux session
  // matches a registered identity name (lowercase comparison).
  const isIdentityPane = tab.targetTmuxSession
    ? identitiesByKey.has(tab.targetTmuxSession.toLowerCase())
    : false;
  return isIdentityPane
    ? <IdentitySessionPane tab={tab} host={host} ... />
    : <TerminalTabContent tab={tab} host={host} ... />;
```

**BUT:** `renderTabContent` is a plain function, not a component — it can't call hooks directly. The `identitiesByKey` lookup must happen at the call site (AppShell or `TerminalTabContent` which already has access to `useIdentities`). This is fine — `TerminalTabContent` could be split into a component that uses the hook.

**Alternative simpler approach:** Always wrap with `IdentitySessionPane` for all terminal tabs, and have `IdentitySessionPane` internally decide whether to show PrettyView based on whether a tmux session name matches an identity. This avoids the detection problem at open time — the wrapper renders PrettyView optimistically and PrettyView handles the "no active session" state gracefully.

### 8. Testing Surface (VERIFIED)

**Existing test files relevant to this phase:**

| File | What it covers | Relevance |
|------|----------------|-----------|
| `Terminal.wiring.test.ts` | Structural greps + split-send behavioral | Must update: PrettyView no longer inside Terminal's JSX; `pvSendInputRef` prop assertions change |
| `Terminal.instrumentation.test.tsx` | Not examined in detail | May need updates for Terminal render shape changes |
| `PrettyView.test.tsx` | Upload flow, phase machine | May need updates if `isIdle` prop is removed |
| `PrettyView.aside.test.tsx` | Aside-arm trigger (isIdle→true transition) | Must update: isIdle now derived internally from store |
| `PrettyView.compose-send.test.tsx` | ComposeBox send + idle-send gate | May need mock for session-working-store instead of isIdle prop |
| `fleet-status-e2e.integration.test.ts` | Fleet-status WS → store → hook pipeline | New tests for tmux-session store should follow this pattern |

**Mocking patterns in use:**

- **PrettyView tests:** `vi.mock("@/api/claude-session-api")` — stub WS factory. Pattern: push each new stub into `wsStubs[]` array so tests can trigger `onmessage`/`onclose`.
- **session-working-store tests:** Call `publishFleetStatusSessionState(hostId, state)` + `__resetForTest()` directly — no WS mock needed.
- **Fleet-status e2e:** `registry.publishSessionState(...)` directly, then `renderHook(() => useSessionIsWorking(key))` and `waitFor()` on the hook result.

**New test insertion points for Phase 41:**

(a) `IdentitySessionPane.test.tsx` — unit tests:
- Terminal does not mount by default (PrettyView is mounted, Terminal is not).
- `togglePrettyMode()` on the wrapper ref → Terminal mounts.
- Second `togglePrettyMode()` → Terminal unmounts.
- PrettyView survives Terminal unmount (stays mounted throughout).

(b) `PrettyView.aside.test.tsx` update:
- Remove `isIdle` prop from test renders.
- Replace with `publishFleetStatusSessionState(hostId, {status: "busy"})` + `publishFleetStatusSessionState(hostId, {status: "idle"})` to drive the transition.

(c) `session-tmux-store.test.ts` — new test file:
- `publishFleetStatusTmuxSession` → `useSessionTmuxName(key)` returns name.
- Gone → null.
- Key-absent → null.

(d) Structural grep test (mirrors `Terminal.wiring.test.ts` pattern):
- PrettyView NOT in Terminal.tsx JSX (after P1).
- `pvSendInputRef` NOT in Terminal.tsx (after P1).
- `isIdle` prop NOT in PrettyView.tsx props (after P2).

### 9. Known Landmines / Rebase-Hot Areas (VERIFIED + INFERRED)

**Confirmed current state of prior-mentioned patches:**

- `#442` (drop `status:shell` from composite) — CONFIRMED LANDED. `session-working-store.ts` L9: `main = status === "busy"` only.
- `#441` (Phase 39 Gate 2 SSH-poll) — CONFIRMED LANDED. `ssh-poll-orchestrator.ts` exists and is complete.
- Phase 35 send-path migration — CONFIRMED. PrettyView's `onRegisterSendInput`/`onRegisterSendInterrupt` props exist in PrettyView.tsx; Terminal.tsx L3365-3371 wires them. `pvSendInputRef` / `pvSendInterruptRef` exist in Terminal.tsx at L181-182.

**Terminal.tsx `isIdle` state:** Terminal.tsx L289 still declares `const [isIdle, setIsIdle] = useState<boolean | null>(null)`. The comment at L290 says the PTY-idle feeder useEffect was RETIRED in Phase 34. The `isIdle` state is vestigial — always `null` in practice. Any code that relies on `isIdle` being set by Terminal will have been broken since Phase 34. This is benign for Phase 41: PrettyView receives `null` for `isIdle` today and must handle it.

**PrettyView `terminalWs` prop:** PrettyView accepts `terminalWs?: WebSocket | null` (L143) for upload functionality. After the restructure, Terminal is only mounted when in terminal mode, so `terminalWs` would be `null` when in PrettyView mode. The upload hook already handles `null` (L143-144: "uploads are effectively disabled — chip strip / drop overlay still render but startBatch will park pending"). This is acceptable since uploads while in PrettyView require Terminal to be connected anyway.

**Phase 40 (text-editor-in-skynet, just landed):** Not examined in detail. The commit comment says it just rebased. If Phase 40 touched `tabUtils.tsx`, `Terminal.tsx`, or `PrettyView.tsx`, those files are recent hot spots. The planner should check for conflicts.

**`Terminal.instrumentation.test.tsx`:** Not examined. If it contains tests that assert on the DOM shape of Terminal (including PrettyView inside it), those tests will break when PrettyView moves out.

**`openFileManager` in TerminalHandle:** The wrapper must also expose `openFileManager` if AppShell calls it. This forwards to the inner Terminal ref when mounted; safe-noop when not mounted.

### 10. Plan-Slice Ordering Recommendation (RESEARCHED)

**Recommendation: P2 before P1.**

**P2 (broadcast read-paths):** Add the fleet-status read-path for isIdle inside PrettyView (drop `isIdle` prop, derive from store). Add the fleet-status read-path for tmuxSessionName in AppShell (extend `onUpdate`/`onSnapshot` callbacks to populate `tmuxSessionNames`). Add `session-tmux-store.ts`. Tests.

**P1 (pane restructure):** New `IdentitySessionPane` wrapper in tabUtils. Hoist `isPrettyMode`, `pvSendInputRef`, `pvSendInterruptRef` to wrapper. Move PrettyView from Terminal's JSX to wrapper's JSX. Remove `isIdle` from Terminal's PrettyView render (already dropped in P2). Remove Terminal's `onTmuxSessionChange` callback dependency from AppShell's `tmuxSessionNames` for identity sessions (already supplemented in P2). Tests.

**Why P2 first:**

After P2 lands (before P1), the intermediate state is:
- PrettyView is still inside Terminal.
- PrettyView reads `isIdle` from the fleet-status store internally (derived from broadcast), ignoring the `isIdle` prop.
- AppShell's `tmuxSessionNames` is populated from BOTH Terminal's callback AND the broadcast.
- Tab title still works even if Terminal's callback fires first (duplicate-safe update).
- Developer sees: PrettyView behavior unchanged (WipBubble, ready-dot, aside-arm all work from broadcast). Tab title now comes from two sources (no regression).

After P1 lands (builds on top of P2):
- PrettyView moves to sibling position under new wrapper.
- Terminal is conditionally mounted.
- The `isIdle` prop is removed from PrettyView props entirely (already no-op'd in P2).
- AppShell's Terminal-callback path for `tmuxSessionNames` is removed for identity sessions.
- Developer sees: Terminal cold-boots on first toggle; PrettyView stays mounted; isIdle + tab title still work (from broadcast).

**What the developer sees mid-phase between P2 and P1:** Identical user-facing behavior. The switch from "isIdle from Terminal prop" to "isIdle from store" is invisible because Terminal's `isIdle` state has been `null` since Phase 34. The broadcast path was already providing the working signal to `WipBubble` — the new code just adds it to the aside-arm gate too.

**If only P1 ships without P2:** PrettyView is standalone but receives `isIdle=null` always (since Terminal's `isIdle` state is vestigial). The aside-arm trigger never fires. The ComposeBox idle-send gate never releases. Tab title never populates from the broadcast. This would be a regression. Do NOT ship P1 without P2.

---

## Common Pitfalls

### Pitfall 1: `isIdle` null vs `false` collapse in the store

**What goes wrong:** `useSessionIsWorking` returns `false` for unknown keys (first-time or never-published sessions). `isIdle = !false = true`. PrettyView's aside-arm fires immediately on mount as a false-positive "idle→working→idle" transition because `prev === false` (from previous state) → `isIdle === true` on re-render when store updates.

**Why it happens:** The store doesn't distinguish "never published" from "published false." `isIdle` needs three states but the store only provides two.

**How to avoid:** Add a `useSessionIsWorkingRaw(): boolean | null` export to `session-working-store.ts` that returns `null` for absent keys (instead of `false`). PrettyView uses this to derive `isIdle: boolean | null` with the same three-state semantics as today.

**Warning signs:** Aside-arm fires immediately on session open; `{type:"aside_arm"}` WS frame visible in DevTools on PrettyView mount.

### Pitfall 2: MessageQueueDrawer loses its send path when Terminal unmounts

**What goes wrong:** `MessageQueueDrawer` (inside Terminal.tsx L3385-3407) calls `pvSendInputRef.current` for sends. If the ref lives in the wrapper but MessageQueueDrawer is still inside Terminal, the ref is accessible. But if MessageQueueDrawer is also moved to the wrapper, the ref needs to be passed as a prop.

**Why it happens:** The current code has `MessageQueueDrawer` inside Terminal's JSX at L3385. After restructure, `MessageQueueDrawer` should move to the wrapper alongside PrettyView (it is the compose surface for the message queue, distinct from PrettyView's ComposeBox).

**How to avoid:** In the restructure, `MessageQueueDrawer` moves to the wrapper level (not inside Terminal). The wrapper provides `pvSendInputRef` directly.

**Warning signs:** Queue sends silently drop (no error, just nothing happens); `pvSendInputRef.current` is null at send time.

### Pitfall 3: TerminalHandle partial implementation in wrapper

**What goes wrong:** AppShell calls methods on `TerminalHandle` besides `togglePrettyMode`: specifically `toggleMessageQueue` (via `useKeyboardMessageQueue`), `notifyResize` (via pane resizing), and `fit` (via various effects). If the wrapper's `useImperativeHandle` doesn't implement these correctly (forwarding to the inner Terminal ref when mounted, nooping when not mounted), subtle breakage occurs.

**Why it happens:** Easy to implement only `togglePrettyMode` since that's the obvious one.

**How to avoid:** Implement the full `TerminalHandle` interface in the wrapper. When Terminal is mounted, forward method calls to the inner Terminal ref. When Terminal is not mounted, implement safe noops or stub returns.

**Warning signs:** Pane resize doesn't propagate to xterm when Terminal is eventually mounted; `fit()` does nothing.

### Pitfall 4: Tab-node background color for the TerminalTabContent replacement

**What goes wrong:** AppShell's `getTabNode()` at L328 sets a background color on the portal DOM node: `if (!isTerminal) el.style.background = "var(--color-pv-base)"` — only for non-terminal tabs. The identity-session pane is still a `type === "terminal"` tab, so it gets the default (no background set). But after restructure, the visual surface is PrettyView-first. The tab node should have the PV base background.

**Why it happens:** `getTabNode(tab.id, tab.type === "terminal")` — the second arg is `true` for terminal tabs, so the PV background is NOT applied.

**How to avoid:** After restructure, update the `getTabNode` call for identity-session panes to pass `false` (or a new flag) so the PV background is applied.

### Pitfall 5: Backend type-check failure when touching fleet-status files

**What goes wrong:** Frontend `tsc --noEmit` does NOT catch backend TypeScript errors. If any backend file under `src/backend/fleet-status/` is modified, the type-check command is `npm run build:backend && npm run build`, not just `npx tsc --noEmit`.

**Why it happens:** Separate tsconfig for backend. This is a fleet rule stated in CONTEXT.md.

**How to avoid:** Per CONTEXT.md: "When touching backend files under `src/backend/`, pre-push typecheck is `npm run build:backend && npm run build`, not just `npx tsc --noEmit`."

**Warning signs:** CI passes tsc but backend fails at runtime with type errors.

---

## Code Examples

### Existing: fleet-status onUpdate in AppShell (extend this)

```typescript
// AppShell.tsx ~L393 — CURRENT:
onUpdate: (state) => {
  publishFleetStatusSessionState(state.hostId, state);
  publishFleetStatusWaitingFor(state.hostId, state.tmuxSession, ...);
},

// AFTER P2 — extend with tmux session name publication:
onUpdate: (state) => {
  publishFleetStatusSessionState(state.hostId, state);
  publishFleetStatusWaitingFor(state.hostId, state.tmuxSession, ...);
  // NEW: also populate tmuxSessionNames for identity tabs via broadcast
  if (state.tmuxSession !== null) {
    const matchingTab = tabs.find(
      (t) =>
        String(t.host?.id) === state.hostId &&
        (t.targetTmuxSession === state.tmuxSession ||
         tmuxSessionNames[t.id] === state.tmuxSession)
    );
    if (matchingTab) {
      handleTmuxSessionChange(matchingTab.id, state.tmuxSession);
    }
  }
},
```

Note: `tabs` from AppShell state is not directly accessible inside `useEffect`'s `onUpdate` callback since the callback is created once at mount (deps: `[]`). The store approach (session-tmux-store) avoids this problem — AppShell's document.title effect reads from the store with a separate lookup.

### Existing: session-working-store pattern to mirror for session-tmux-store

```typescript
// session-working-store.ts pattern — KEY is `${hostId}:${tmuxSession ?? ""}`
// Mirror for session-tmux-store.ts:
export function publishFleetStatusTmuxSession(
  hostId: string,
  tmuxSession: string | null,
): void {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  // ... same Map + listener pattern
}

export function useSessionTmuxName(key: string | null): string | null {
  // useSyncExternalStore — returns null for absent keys
}
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Terminal's `isIdle` state has been vestigially `null` since Phase 34 and PrettyView receives `null` for `isIdle` in production today | §3 | Low — the code comment is explicit and matches the store architecture |
| A2 | Phase 40 (text-editor-in-skynet) did not materially change Terminal.tsx or PrettyView.tsx architecture | §9 | Medium — researcher did not examine Phase 40 files; planner should verify with `git diff HEAD~1 -- Terminal.tsx PrettyView.tsx` |
| A3 | `MessageQueueDrawer` is inside Terminal.tsx JSX (not in tabUtils or AppShell) | §9 | Low — verified at Terminal.tsx L3385 |
| A4 | The existing "Connecting…" UX (SimpleLoader) in Terminal.tsx already handles the cold-boot moment and no new loading state is needed | §6 | Low — code at L3460 confirms the loader is present and guards on `!isPrettyMode` |

---

## Open Questions

1. **`tabs` closure in fleet-status `onUpdate` callback**
   - What we know: `useEffect(() => { createFleetStatusClient({onUpdate: ...}) }, [])` — deps `[]` means the callback closes over initial `tabs` value.
   - What's unclear: The tmux-name-to-tabId matching in `onUpdate` needs current `tabs`, but the callback is stale-closed.
   - Recommendation: Use the session-tmux-store pattern (module-scoped Map) rather than trying to call `setTmuxSessionNames` from inside the stale callback. AppShell's document.title effect reads from the new store using `(hostId, tmuxSession)` as the key, derived from the active tab's `host.id` + `targetTmuxSession`.

2. **`IdentitySessionPane` scope detection before tmuxSessionName is known**
   - What we know: At tab-open time, `tab.targetTmuxSession` may be set (if opened from conversation list). But for restored tabs from persisted state, `targetTmuxSession` may reflect the stored name.
   - What's unclear: Is `targetTmuxSession` always set for identity-session tabs?
   - Recommendation: Use `tab.targetTmuxSession?.toLowerCase()` matched against `identitiesByKey` as the scope gate. If it is null (edge case), fall back to the non-wrapper path — Terminal auto-detects and auto-activates PrettyView the old way. This is a corner case for the transition period.

3. **`MessageQueueDrawer` location after restructure**
   - What we know: Currently inside Terminal.tsx JSX at L3385; reads `pvSendInputRef.current`.
   - What's unclear: Should it move to the wrapper, or stay in Terminal and receive `pvSendInputRef` as a prop?
   - Recommendation: Move `MessageQueueDrawer` to the wrapper, alongside PrettyView. The wrapper has `pvSendInputRef` in scope. The MessageQueueDrawer's `isMessageQueueOpen` state also hoists to the wrapper (or wrapper-level state).

---

## Environment Availability

Step 2.6 SKIPPED — this phase is code/config changes only; no new external tools, services, or CLIs are required.

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json`. This section is omitted.

---

## Security Domain

`security_enforcement: true` in `.planning/config.json`. `security_asvs_level: 1`.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surface |
| V3 Session Management | No | No session token changes |
| V4 Access Control | No | No new ACL |
| V5 Input Validation | No | No new user inputs |
| V6 Cryptography | No | No crypto |

No new threat surface is introduced by this phase. The pane restructure is a frontend composition change. The fleet-status broadcast already authenticates subscribers via JWT (verified in `fleet-status-server.ts` L60-75). The new `session-tmux-store` is a client-side in-memory store fed from the authenticated fleet-status WS — no injection risk.

---

## Sources

### Primary (HIGH confidence)
- `src/ui/features/terminal/Terminal.tsx` — direct source read; current state verified
- `src/ui/shell/tabUtils.tsx` — direct source read; full file examined
- `src/ui/AppShell.tsx` — direct source read; relevant sections examined
- `src/ui/features/pretty-view/PrettyView.tsx` — direct source read; isIdle + isWorking wiring examined
- `src/ui/state/session-working-store.ts` — direct source read; full file examined
- `src/ui/api/fleet-status-client.ts` — direct source read; full file examined
- `src/ui/api/fleet-status-types.ts` — direct source read; SessionState.tmuxSession confirmed present
- `src/backend/fleet-status/wire-protocol.ts` — direct source read; SessionState.tmuxSession confirmed present
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — direct source read; tmuxSession resolution path examined
- `src/ui/features/terminal/terminal-types.ts` — direct source read; TerminalHandle interface examined

### Secondary (MEDIUM confidence)
- Phase 41 CONTEXT.md — LOCKED decisions; authoritative for scope
- `.planning/shapes/shape-deferred-terminal-mount.md` — design contract; authoritative for philosophy

---

## Metadata

**Confidence breakdown:**
- Current pane arrangement: HIGH — read directly from source
- State inventory to hoist: HIGH — verified by source read
- Fleet-status wire schema: HIGH — `SessionState.tmuxSession` verified in both backend and frontend types
- isIdle re-sourcing path: HIGH — store exists, hook exists, current isIdle is vestigially null
- Tab-title mechanism: HIGH — AppShell source read; tmuxSessionNames pattern verified
- Plan-slice ordering: HIGH — rationale is deterministic from the code state
- Test infrastructure: HIGH — test files listed and patterns verified
- `MessageQueueDrawer` location: HIGH — verified at Terminal.tsx L3385

**Research date:** 2026-08-14
**Valid until:** 2026-09-14 (stable codebase; fast-moving component area — re-verify Terminal.tsx before executing if more than 1 week elapses)
