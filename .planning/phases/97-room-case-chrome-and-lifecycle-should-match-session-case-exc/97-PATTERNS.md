# Phase 97: Room-case chrome and lifecycle should match session-case — Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 10 (7 extend-in-place · 0 new · 0 delete · 3 test-migrate) + optional new test files
**Analogs found:** 10 / 10 — every finding has a concrete in-codebase analog, most within the file being modified (this is a case-branch fill-in arc, not greenfield).

> **Meta-guidance:** Phase 97 fills in case-branches Phase 93's two-source chat surface required but never made. Every "fix" is either (a) extending an existing case-branched surface with one more branch, (b) reflowing chrome so a hidden affordance's footprint disappears, or (c) mirroring the harness case's URL-round-trip pattern for the relay case. NO new files ship (except optional new test files). Every pattern is derived from an existing file — extend + case-branch, do not reinvent. **The regression floor is byte-identical harness case behavior; every change is gated on `source.kind === "relay"` (adapter/PrettyView layer) or `mode === "relay"` (ComposeBox layer).**

---

## File Classification

| Finding | File | Role | Data Flow | Closest Analog / Extension Surface | Match Quality |
|--:|------|------|-----------|------------------------------------|---------------|
| 1 | `src/ui/features/pretty-view/sources/chat-surface-source.ts` | **extend-in-place** (type module) | — | (self — extend `ChatSurfaceAdapterState` L67-79 with `isMessagesLoaded?: boolean`) | exact |
| 1 | `src/ui/features/pretty-view/sources/use-relay-adapter.ts` | **extend-in-place** (hook state) | WS event-driven | (self — extend `history_batch` branch L438-445 + `useMemo` returned shape L605-625) | exact |
| 1 | `src/ui/features/pretty-view/sources/use-harness-adapter.ts` | **extend-in-place** (inert shim) | — | (self — `INERT_STATE` L26-32 gets `isMessagesLoaded: true` default) | exact |
| 1 | `src/ui/features/pretty-view/PrettyView.tsx` | **extend-in-place** (veil mount gate) | request-response | (self — veil mount gate L3782 + effect L2002-2013 case-aware for relay) | exact |
| 2 | `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` | **extend-in-place** (thread `tabId`) | pure render | Harness single-badge site `PrettyView.tsx:3539-3555` (verbatim `tabId={tabId}` pattern to mirror) | exact |
| 2 | `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` | **extend-in-place** (thread `tabId`) | pure render | Same harness site `PrettyView.tsx:3539-3555` | exact |
| 2 | `src/ui/features/pretty-view/PrettyView.tsx` | **extend-in-place** (pass `tabId` to MultiBadgeAnchor) | pure render | Harness mount L3539-3555 already accepts `tabId={tabId}` — mirror at relay-branch call L3567-3576 | exact |
| 2 | `src/ui/shell/SplitView.tsx` | **discovery + instrument** (may not require code change) | event-driven | Existing native drop-target listener L297-575 + existing `[pv-split-preview]` log L358 | exact |
| 3 | `src/ui/features/pretty-view/ComposeBox.tsx` | **extend-in-place** (mode-gate `pl-11` + add pebble headroom spacer) | request-response | (self — L2836 `showPaperclip && "pl-11"` + Row 1 mode-gate pattern L2334) | exact |
| 4 | `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` | **extend-in-place** (single-token) | pure render | (self — `ROOT_ANCHOR_CLASS` L192-193 constant) | exact |
| 5 | `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` | **extend-in-place** (wrap appendage in drawer) | pure render | Prototype `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html:164-177` (Variant A CSS verbatim) | exact |
| 6 | `src/ui/features/pretty-view/PrettyView.tsx` | **extend-in-place** (case-branch `identityName` prop) | pure render | (self — L4249 `identityName={pvIdentity?.displayName}` + Phase 93 case-branch pattern at L4171 `onOptimisticSend`) | exact |
| 7 | `src/ui/lib/tab-url.ts` | **extend-in-place** (widen grammar) | pure transform | (self — `TabSpec` L43-47 + `PROTOCOLS` L73-79 + `parseTabParam` L81-99 + `encodeTabSpec` L101-107 + `specForTab` L140-157) | exact |
| 7 | `src/ui/AppShell.tsx` | **extend-in-place** (URL-sync input + tab-restore output) | request-response | (self — URL-sync effect L910-972 + tab-restore loop L1254-1318) | exact |
| — | `PrettyView.relay-source.test.tsx` (existing) | **test-migrate** | — | (self — add `isMessagesLoaded` assertion + case-branch pattern already present) | exact |
| — | `use-relay-adapter.test.ts` (existing) | **test-migrate** | — | (self — mirror existing `session` frame test for new `isMessagesLoaded` flip) | exact |
| — | `tab-url.test.ts` (existing) | **test-migrate** | — | (self — mirror existing `tmux:` round-trip tests for new `relay:` protocol) | exact |
| — | `PrettyView.relay-veil.test.tsx` | **new-file** (test, optional) | — | Existing `PrettyView.relay-source.test.tsx` (naming convention) | exact |
| — | `MultiBadgeAnchor.drag-source.test.tsx` | **new-file** (test, optional) | — | Existing `MultiBadgeAnchor.test.tsx` | exact |
| — | `ComposeBox.relay-reflow.test.tsx` | **new-file** (test, optional) | — | Existing `ComposeBox.mode-hide.test.tsx` | exact |
| — | `AgentBadgeWithMeter.drawer.test.tsx` | **new-file** (test, optional) | — | Existing `AgentBadgeWithMeter.test.tsx` | exact |
| — | `tab-url.relay-round-trip.test.ts` | **new-file** (test, optional) | — | Existing `tab-url.test.ts` | exact |

---

## Pattern Assignments

### Finding 1 — Loading veil dismisses on `history_batch`

#### `src/ui/features/pretty-view/sources/chat-surface-source.ts` (EXTEND-IN-PLACE)

**Analog (self):** `ChatSurfaceAdapterState` interface at L67-79. It already carries optional pagination fields (`hasOlder`, `loadOlderStatus`, `loadOlderError`, `fetchOlder`). Add one more optional field alongside.

**Current shape (L67-79):**
```typescript
export interface ChatSurfaceAdapterState {
  messages: ChatSurfaceMessage[];
  participants: ChatSurfaceParticipants | null;
  sendMessage: (body: string, mqid: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
  // Optional pagination fields — Slice 3's relay adapter populates them; the
  // harness shim leaves them undefined.
  hasOlder?: boolean;
  loadOlderStatus?: "idle" | "loading" | "error";
  loadOlderError?: string | null;
  fetchOlder?: () => Promise<void>;
}
```

**Extension shape (add `isMessagesLoaded` after `isReady`):**
```typescript
export interface ChatSurfaceAdapterState {
  messages: ChatSurfaceMessage[];
  participants: ChatSurfaceParticipants | null;
  sendMessage: (body: string, mqid: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
  /**
   * Phase 97 Finding 1: FLIPS TRUE on the first `history_batch` frame
   * (relay adapter) or is naturally `true` for the harness inert shim.
   * PrettyView's loading-veil mount gate reads this in the relay case as
   * the "backend has responded with historical messages" signal. `isReady`
   * flips earlier (on `session` frame — WS-auth pass) and is NOT the right
   * signal for the veil per RESEARCH § Finding 1 landmines.
   */
  isMessagesLoaded?: boolean;
  // ... existing optional pagination fields unchanged ...
}
```

**Discipline:** Optional field. Harness shim leaves undefined (or defaults to `true` — see below); relay adapter populates. This is additive — no existing consumer breaks.

---

#### `src/ui/features/pretty-view/sources/use-harness-adapter.ts` (EXTEND-IN-PLACE — inert default)

**Analog (self):** `INERT_STATE` at L26-32.

**Current shape:**
```typescript
const INERT_STATE: ChatSurfaceAdapterState = {
  messages: [],
  participants: null,
  sendMessage: async () => false,
  error: null,
  isReady: true,
};
```

**Extension shape:**
```typescript
const INERT_STATE: ChatSurfaceAdapterState = {
  messages: [],
  participants: null,
  sendMessage: async () => false,
  error: null,
  isReady: true,
  // Phase 97 Finding 1: the harness case's veil is driven off pane-state,
  // NOT this field. Setting `true` here is the "no-op" default — harness
  // veil consumer gates on `source.kind === "harness"` and reads
  // `renderedState === "resolving"` instead, so this field is never read
  // in the harness case. Keeping it `true` (rather than `undefined`)
  // codifies "adapter reports messages-loaded" for the inert shim.
  isMessagesLoaded: true,
};
```

**Discipline:** Inert-shim discipline preserved (no hooks called, singleton returned). This shim exists PURELY for hook-order stability per Pitfall 2 (RESEARCH § Landmines 5).

---

#### `src/ui/features/pretty-view/sources/use-relay-adapter.ts` (EXTEND-IN-PLACE — state + frame-branch + memo)

**Analog (self):** The `isReady` state slot and its flip site on `session` / `history_batch` frames.

**Current isReady flip on `history_batch` (L438-445):**
```typescript
case "history_batch":
  setHistory(parsed.events);
  setHasOlder(parsed.hasMore);
  setLoadOlderStatus("idle");
  setLoadOlderError(null);
  // Belt-and-suspenders: history_batch also flips isReady=true (in
  // case a session frame is somehow missed — defensive).
  setIsReady(true);
  break;
```

**Extension shape (add a new `isMessagesLoaded` state + flip on `history_batch` ONLY):**
```typescript
// At the useState declarations block (near `isReady`):
const [isMessagesLoaded, setIsMessagesLoaded] = useState<boolean>(false);

// In the frame dispatch — history_batch branch:
case "history_batch":
  setHistory(parsed.events);
  setHasOlder(parsed.hasMore);
  setLoadOlderStatus("idle");
  setLoadOlderError(null);
  setIsReady(true);
  // Phase 97 Finding 1: flip isMessagesLoaded=true on history_batch —
  // this is the "backend has read the room's history" signal, matching
  // the harness veil's dismiss trigger (pane_state:active from the
  // backend session server). Fires on empty rooms too (events may be
  // an empty array — the FRAME arrival is the signal, not the array
  // cardinality — per RESEARCH § Finding 1 landmines).
  setIsMessagesLoaded(true);
  break;
```

**Memoize return shape (L605-625):**
```typescript
const memoizedActiveState = useMemo(() => ({
  messages,
  participants,
  sendMessage,
  error,
  isReady,
  isMessagesLoaded,   // NEW — add to returned shape
  hasOlder,
  loadOlderStatus,
  loadOlderError,
  fetchOlder,
}), [
  messages,
  participants,
  sendMessage,
  error,
  isReady,
  isMessagesLoaded,   // NEW — add to deps
  hasOlder,
  loadOlderStatus,
  loadOlderError,
  fetchOlder,
]);
```

**Landmines from RESEARCH (preserve Phase 93 post-close discipline):**
- **Rules-of-hooks discipline:** `useState` for `isMessagesLoaded` MUST live above the `if (source === null) return IDLE_STATE;` early-return at L631, alongside all other useState / useMemo calls.
- **`useMemo` deps updated:** The returned shape memo at L605-625 MUST include `isMessagesLoaded` in the deps array (RESEARCH § Landmines 4 — memoize discipline).
- **Reset on WS reopen:** When the WS reconnects, reset `isMessagesLoaded = false` alongside the existing `setIsReady(false)` reset if applicable. Trace the current isReady-reset site during implementation; mirror it. (The current adapter resets on cancel/cleanup — verify during execution.)
- **`IDLE_STATE` singleton at L631:** update its shape to include `isMessagesLoaded: false` (or leave undefined; the veil consumer gates on `source.kind === "relay"` so undefined is safe on the harness inert path).

---

#### `src/ui/features/pretty-view/PrettyView.tsx` (EXTEND-IN-PLACE — case-branch veil mount)

**Analog (self):** The veil mount gate at L3782 + the effect that arms `showResolvingSpinner` at L2002-2013.

**Current veil mount gate (L3782):**
```tsx
{showResolvingSpinner && <PrettyViewLoadingOverlay />}
```

**Current arming effect (L2002-2013):**
```tsx
useEffect(() => {
  if (renderedState !== "resolving") {
    setShowResolvingSpinner(false);
    return;
  }
  const t = setTimeout(() => {
    setShowResolvingSpinner(true);
  }, 400);
  return () => {
    clearTimeout(t);
  };
}, [renderedState]);
```

**Extension shape (RECOMMENDED — case-branched veil mount, data-driven):**

The existing effect stays. Add a peer effect that arms the veil for the relay case, gated on `source.kind === "relay" && !chatSurfaceAdapter.isMessagesLoaded`. Both effects call the same `setShowResolvingSpinner` — the veil consumer at L3782 reads the same state.

```tsx
// Existing effect (unchanged — harness path).
useEffect(() => {
  if (source.kind !== "harness") return;
  if (renderedState !== "resolving") {
    setShowResolvingSpinner(false);
    return;
  }
  const t = setTimeout(() => setShowResolvingSpinner(true), 400);
  return () => clearTimeout(t);
}, [source.kind, renderedState]);

// NEW peer effect — relay path.
useEffect(() => {
  if (source.kind !== "relay") return;
  if (chatSurfaceAdapter.isMessagesLoaded === true) {
    setShowResolvingSpinner(false);
    return;
  }
  // Same 400ms delay-arm as harness path — suppresses flash on
  // fast WS reconnects (RESEARCH § Finding 1 landmines).
  const t = setTimeout(() => setShowResolvingSpinner(true), 400);
  return () => clearTimeout(t);
}, [source.kind, chatSurfaceAdapter.isMessagesLoaded]);
```

**Alternative (single-effect):** Compute a case-agnostic `veilConditionActive` inside one effect. Both shapes work; the peer-effect shape above is closer to the existing patch #148 discipline and easier to test.

**Discipline (D-01 no-accidental-inheritance):**
- **Harness path byte-untouched.** The gate at L2003 (`renderedState !== "resolving"`) fires on the existing pane-state machine, entirely unchanged. The addition of a `source.kind !== "harness"` early-guard is a NULL change for the harness case (`source.kind === "harness"` in every harness call site).
- **Relay path new.** The new peer effect only fires when `source.kind === "relay"`. The veil dismisses when the relay adapter flips `isMessagesLoaded = true` — the "backend has read history and shipped a batch" signal.
- **400ms delay-arm preserved in both cases** — flash-suppression discipline.

---

### Finding 2 — Drag-drop split placement

#### `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` (EXTEND-IN-PLACE — thread `tabId`)

**Analog:** The harness single-badge site at `PrettyView.tsx:3539-3555` — verbatim `tabId={tabId}` pattern to mirror.

**Analog excerpt (harness case, `PrettyView.tsx:3539-3555`):**
```tsx
{source.kind === "harness" && pvIdentityKey && (
  <IdentityBadge
    identityKey={pvIdentityKey}
    hostId={hostId}
    onClick={() => setIsIdentityModalOpen(true)}
    onLongPress={onTogglePrettyMode}
    tabId={tabId}  // ← the drag-source contract
    onContextMenu={
      identityBadgeContextMenuItems && ...
    }
  />
)}
```

**Current MultiBadgeAnchor (missing `tabId`) — `MultiBadgeAnchor.tsx:129 + 164`:**
```tsx
// HumanBadgeCell body (L129):
<IdentityBadge identityKey={identityKey} />

// AgentBadgeCell fallback body (L164):
<IdentityBadge identityKey={identityKey} />
```

**Extension shape (thread `tabId` through props):**
```tsx
// 1. Widen MultiBadgeAnchorProps (L64-94):
export interface MultiBadgeAnchorProps {
  participants: { humans: HumanParticipant[]; agents: AgentParticipant[] };
  viewingUserMxid: string;
  fleetIdentityHosts: Record<string, number>;
  isReady: boolean;
  className?: string;
  /**
   * Phase 97 Finding 2: the enclosing relay tab's tabId. Threaded to every
   * per-participant IdentityBadge so each badge becomes a drag SOURCE
   * carrying the ROOM tab's tabId. Dragging any participant's badge drags
   * the whole room tab (per D-05). Undefined → badges are not drag-sourceable
   * (parity with pre-Phase-97 behavior).
   */
  tabId?: string;
}

// 2. Thread through HumanBadgeCell (L115-132):
function HumanBadgeCell({ human, tabId }: { human: HumanParticipant; tabId?: string }) {
  // ... existing identityKey resolution unchanged ...
  return (
    <div data-testid="relay-room-participant" data-role="human" data-mxid={human.mxid}
         className="relative shrink-0 h-[72px] w-[220px] flex flex-col items-stretch">
      <IdentityBadge identityKey={identityKey} tabId={tabId} />
    </div>
  );
}

// 3. Thread through AgentBadgeCell (L140-185) — both the fallback branch
//    AND the AgentBadgeWithMeter branch:
function AgentBadgeCell({ agent, fleetIdentityHosts, tabId }: {
  agent: AgentParticipant;
  fleetIdentityHosts: Record<string, number>;
  tabId?: string;
}) {
  const identityKey = agent.identityKey;
  const hostId = fleetIdentityHosts[identityKey];
  if (hostId === undefined) {
    // ... structured warn unchanged ...
    return (
      <div ...>
        <IdentityBadge identityKey={identityKey} tabId={tabId} />
      </div>
    );
  }
  return (
    <div ...>
      <AgentBadgeWithMeter
        identityKey={identityKey}
        mxid={agent.mxid}
        hostId={hostId}
        tmuxSessionName={identityKey}
        tabId={tabId}  // NEW
      />
    </div>
  );
}

// 4. Thread from MultiBadgeAnchor (L195-264):
export function MultiBadgeAnchor({ participants, viewingUserMxid, fleetIdentityHosts, isReady, className, tabId }: MultiBadgeAnchorProps) {
  // ... sort discipline unchanged ...
  return (
    <div data-testid="multi-badge-anchor" className={cn(ROOT_ANCHOR_CLASS, className)}>
      {agentsSorted.map((a) => (
        <AgentBadgeCell key={a.mxid} agent={a} fleetIdentityHosts={fleetIdentityHosts} tabId={tabId} />
      ))}
      {humansOther.map((h) => (
        <HumanBadgeCell key={h.mxid} human={h} tabId={tabId} />
      ))}
    </div>
  );
}
```

**Discipline (D-18 preserved):** IdentityBadge's `isDragSource = !!tabId && !isMobile` at L82 gates drag-source SEPARATELY from onClick. Not passing `onClick` (as MultiBadgeAnchor currently does not) keeps badge-click a no-op in the relay case; passing `tabId` adds drag-source without disturbing the click contract. The two are orthogonal (RESEARCH § Finding 2 landmines).

---

#### `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` (EXTEND-IN-PLACE — thread `tabId`)

**Analog (self):** Same harness pattern; extend props + pass through.

**Current shape (L80-96 props, L100-105 signature, L186 body):**
```tsx
export interface AgentBadgeWithMeterProps {
  identityKey: string;
  mxid: string;
  hostId: number;
  tmuxSessionName: string;
}

export function AgentBadgeWithMeter({
  identityKey,
  mxid: _mxid,
  hostId,
  tmuxSessionName,
}: AgentBadgeWithMeterProps) {
  // ...
  return (
    <div className="relative flex flex-col items-center gap-1">
      <IdentityBadge identityKey={identityKey} />
      {/* appendage ... */}
    </div>
  );
}
```

**Extension shape:**
```tsx
export interface AgentBadgeWithMeterProps {
  identityKey: string;
  mxid: string;
  hostId: number;
  tmuxSessionName: string;
  /** Phase 97 Finding 2: enclosing tab's tabId — drag-source pass-through. */
  tabId?: string;
}

export function AgentBadgeWithMeter({
  identityKey,
  mxid: _mxid,
  hostId,
  tmuxSessionName,
  tabId,
}: AgentBadgeWithMeterProps) {
  // ...
  return (
    <div className="relative flex flex-col items-center gap-1">
      <IdentityBadge identityKey={identityKey} tabId={tabId} />
      {/* appendage ... */}
    </div>
  );
}
```

**Discipline:** ZERO change to appendage, meter well, reset button. `tabId` is a passive pass-through onto the same primitive the harness case uses.

---

#### `src/ui/features/pretty-view/PrettyView.tsx` (EXTEND-IN-PLACE — pass `tabId` to MultiBadgeAnchor)

**Analog (self):** The harness call site at L3539-3555 already passes `tabId={tabId}`. Mirror at the relay branch.

**Current relay mount (L3567-3576):**
```tsx
{source.kind === "relay" && (
  <MultiBadgeAnchor
    participants={
      chatSurfaceAdapter.participants ?? { humans: [], agents: [] }
    }
    viewingUserMxid={viewingUserMxid ?? ""}
    fleetIdentityHosts={fleetIdentityHosts}
    isReady={chatSurfaceAdapter.isReady}
  />
)}
```

**Extension shape:**
```tsx
{source.kind === "relay" && (
  <MultiBadgeAnchor
    participants={
      chatSurfaceAdapter.participants ?? { humans: [], agents: [] }
    }
    viewingUserMxid={viewingUserMxid ?? ""}
    fleetIdentityHosts={fleetIdentityHosts}
    isReady={chatSurfaceAdapter.isReady}
    tabId={tabId}  // NEW — Finding 2 drag-source parity
  />
)}
```

**Discipline (D-01/D-05):** The relay branch now wires the same drag-source contract the harness branch wires. Dragging any participant's badge drags the whole room tab.

---

#### `src/ui/shell/SplitView.tsx` (DISCOVERY + INSTRUMENT — may not require code change)

**Analog (self):** Existing native drop-target listener at L297-575 + existing `[pv-split-preview]` structured log at L358.

**Sequence-front task per D-07:** Add a temporary `[pv-split-drop-diag]` structured log at native `dragover` / `drop` on a relay-showing Pane. Reproduce Ashley's flow:

1. Open plain session → open room → close room → try to drag another session onto the plain session's Pane.
2. Confirm what breaks: does the plain-session Pane's dragover still fire? Does the coral overlay still paint? Does the drop still route to `onOpenSessionInTree`?

**Existing structured-log pattern to mirror (L356-360):**
```typescript
console.info(
  `[pv-split-preview] pane path=${JSON.stringify(path)} zone=${zone} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)} rectLTRB=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`,
);
```

**Diagnostic log shape (RECOMMENDED — mirror `pv-split-preview` string form):**
```typescript
// eslint-disable-next-line no-console
console.info(
  `[pv-split-drop-diag] pane path=${JSON.stringify(path)} tabIdSource=${sourceTabId} hasBadgePayload=${badgeJson.length > 0} hasRowPayload=${rowJson.length > 0}`,
);
```

**Verdict paths:**
- **If plain-session Pane behaves correctly after room open/close cycle** → Ashley's "shared-state corruption" is a red herring. The fix reduces to threading `tabId` through MultiBadgeAnchor (above). NO SplitView change ships. Diagnostic log can stay as ambient instrumentation OR be removed.
- **If plain-session Pane misbehaves after a room mount** → identify which handler misbehaves. Full diagnosis THEN decide split-out per D-07.

**Landmines from RESEARCH:**
- **Do NOT plumb window-level state changes.** If diagnosis surfaces window-listener leakage, the fix is listener-cleanup discipline, NOT a global registry (RESEARCH § Finding 2 landmines).
- **`dataTransfer` MIME contract is load-bearing** — `application/x-skynet-badge: JSON.stringify({tabId})` per `IdentityBadge.tsx:203-214`. Same MIME + JSON shape for relay drags; downstream handlers don't need to know case.

---

### Finding 3 — ComposeBox ghost gutter + vertical fit + pebble headroom

#### `src/ui/features/pretty-view/ComposeBox.tsx` (EXTEND-IN-PLACE — three atomic reflow steps)

**Analog #1 (self, mode-gate pattern at L2334):** Phase 93 already established the case-branch idiom.

**Analog excerpt (existing mode-gate at L2334):**
```tsx
{mode !== "relay" && (
<div data-testid="compose-row-1" className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
  {/* Row 1 body */}
</div>
)}
```

**Analog excerpt (existing paperclip mode-gate at L2908):**
```tsx
{showPaperclip && mode !== "relay" && (
  <button type="button" onClick={() => handleOpenFilePicker("primary")} ...>
    <Paperclip className="size-6" />
  </button>
)}
```

**Step 1 — kill ghost `pl-11` gutter (L2836):**

**Current (L2836):**
```tsx
showPaperclip && "pl-11",
```

**Extension shape:**
```tsx
showPaperclip && mode !== "relay" && "pl-11",
```

**Rationale:** The `pl-11` (44px left padding) reserves space for a Paperclip button that no longer renders in relay mode (already gated at L2908). Same mode-gate idiom as L2334 and L2908 — consistency preserved.

---

**Step 2 — give QueuePlusTab vertical headroom:**

**Analog (self, existing mode-gate on Row 1 at L2334):** When Row 1 is present (harness mode), it provides `mb-[3px]` bottom-margin + intrinsic ~32-44px vertical space above the Textarea's wrapper. When Row 1 disappears (relay mode), the wrapper at L2695 sits at the top of the compose container with no headroom.

**Current L2695 wrapper:**
```tsx
<div className="relative flex-1 self-stretch" data-testid="compose-primary-wrapper">
```

**Two equivalent options (planner picks):**

**Option A (RECOMMENDED — mode-aware padding-top on primary wrapper):**
```tsx
<div
  className={cn(
    "relative flex-1 self-stretch",
    // Phase 97 Finding 3: when Row 1 (Meter+aux instrument bar) is hidden
    // in relay mode, restore headroom above the Textarea so QueuePlusTab
    // pebble (rides on the wrapper's top edge via absolute -top-N) is not
    // clipped by the ComposeBox outer container.
    mode === "relay" && "pt-2",  // tune the exact value based on QueuePlusTab -top-N offset
  )}
  data-testid="compose-primary-wrapper"
>
```

**Option B — mode-specific invisible Row 1 skeleton:**
```tsx
{mode === "relay" && (
  <div
    data-testid="compose-row-1-relay-spacer"
    aria-hidden="true"
    className={cn(
      "mb-[3px]",
      isTouchDevice ? "min-h-[44px]" : "min-h-8",
    )}
  />
)}
```

Placed at the SAME position as Row 1's `{mode !== "relay" && (...)}` block (L2334). This preserves the vertical geometry byte-for-byte between harness and relay cases — the wrapper below sees identical layout.

**Recommendation from RESEARCH:** Option B is cleaner (preserves geometry byte-for-byte; Ashley's ask is parity in feel). Option A requires a fine-tune of the `pt-N` value against the QueuePlusTab's absolute offset. Executor picks based on live visual review.

---

**Step 3 — verify vertical parity (D-09):**

After Steps 1 + 2, measure the ComposeBox's total height in relay vs harness mode. Match within 1px → D-09 satisfied by construction. Residual delta → hunt in Row 2's gap, outer container padding-bottom, or flex-item stretch behavior.

**Analog (harness case):** The harness-mode ComposeBox bounding rect at the same viewport size IS the reference. No new design.

**Landmines from RESEARCH:**
- **Do NOT hide QueuePlusTab in relay mode.** Ashley wants the top-edge affordance to work (RESEARCH § Finding 3 landmines).
- **Do NOT reintroduce Row 1 chrome to "solve" pebble headroom.** D-11 locked the monolithic Row 1 hide.
- **Do NOT touch Textarea's `min-h-8!` / `!` specificity** (L2792 and adjacent). Load-bearing against shadcn Textarea `min-h-[80px]` and `dark:bg-input/30`.
- **Do NOT let reflow spill into harness case.** All new class tokens gated on `mode === "relay"` (or equivalently `mode !== "relay"` — reserving harness as the default).

---

### Finding 4 — MultiBadgeAnchor gap tighten

#### `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` (EXTEND-IN-PLACE — single token)

**Analog:** None (there is no session-case analog for multi-badge — the harness case has exactly one badge). The reference is Ashley's judgment "halve the gap."

**Current (L192-193):**
```typescript
const ROOT_ANCHOR_CLASS =
  "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2";
```

**Extension shape:**
```typescript
const ROOT_ANCHOR_CLASS =
  "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-1";
```

**Rationale:** `gap-2` (8px) matches the harness case's OUTER instrument-row gap (`ComposeBox.tsx:2335` — `flex items-center gap-2`). Applied as an INNER gap between MultiBadgeAnchor cells, it reads as "too wide" — badges look like separate zones. Halve to `gap-1` (4px). Executor may fine-tune based on visual result.

**Discipline:**
- **Single-token change.** Do NOT reshape sort order, loading placeholder, self-exclusion filter, or `flex-row-reverse` layout — all Phase 93 locks.
- **`flex-row-reverse` semantics preserved.** `gap-N` is direction-agnostic; no layout math shifts.

---

### Finding 5 — Meter drawer chrome

#### `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` (EXTEND-IN-PLACE — wrap appendage in drawer)

**Analog:** Prototype at `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html` **Variant A** — the locked design pattern.

**Prototype excerpt (meter-tasting.html:164-177 verbatim):**
```css
/* VARIANT A — Simple slotted drawer */
.v-a .drawer {
  position: relative;
  margin-top: -8px;       /* tuck up under the pill */
  z-index: 1;             /* behind the pill (pill z-index: 2) */
  padding-top: 10px;      /* keep the meter body away from the tucked edge */
}
.v-a .drawer .meter-well {
  width: 6rem;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  border-top: 0;
}
```

**Current AgentBadgeWithMeter appendage (L189-192):**
```tsx
<div
  data-appendage="true"
  data-role="agent-appendage"
  className="mt-1 flex flex-row items-stretch gap-0"
>
  {/* meter-well (reset button + segments) ... */}
</div>
```

**Extension shape (wrap appendage in drawer + adjust meter-well corners):**
```tsx
{/* Phase 97 Finding 5: drawer wrapper — Variant A "simple slotted"
    (meter-tasting.html L164-177). Drawer sits below the pill; its
    margin-top: -8px tucks its top edge behind the pill's bottom.
    z-index: 1 (implicit via stacking context) sits behind the pill.
    padding-top: 10px keeps the meter body clear of the tucked edge. */}
<div
  data-drawer="true"
  className="relative -mt-2 pt-[10px]"  // Tailwind: -mt-2 = -8px; pt-[10px] arbitrary value
  style={{ zIndex: 1 }}
>
  <div
    data-appendage="true"
    data-role="agent-appendage"
    className="flex flex-row items-stretch gap-0"
    // NOTE: `mt-1` REMOVED — was the 4px spacer between pill and appendage;
    // drawer's -mt-2 + pt-[10px] replaces it with the tucked-slot geometry.
  >
    {/* Meter-well — corner tokens ADJUSTED for the drawer's tucked-top look:
        - top corners squared (border-top-left/right-radius: 0)
        - bottom corners rounded (border-bottom-left/right-radius: 6px)
        - top border removed (border-top: 0) so the tuck reads as invisible.
        Rest of the well styling unchanged. */}
    <div
      className={cn(
        "self-stretch flex flex-row p-[2px]",
        "bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)]",
        "border-t-0",  // NEW — no top border (drawer edge invisible)
        "rounded-b-md",  // NEW — replaces `rounded-md`, only bottom corners round
        "shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]",
      )}
      // ... rest of meter well body byte-untouched ...
    >
      {/* reset button + segments unchanged */}
    </div>
  </div>
</div>
```

**Watch-out from RESEARCH (Finding 5 landmines):**
- **The pill is `absolute top-4 right-5` inside its own rootClassName** (`IdentityBadge.tsx:110`). The `AgentBadgeWithMeter` root at L183 is `relative flex flex-col items-center gap-1`. The IdentityBadge is absolutely positioned inside this cell — verify with DevTools before locking `-mt-2` that the tuck geometry lands correctly. May need to be an absolute-positioned drawer instead of a negative-margin one. Executor's call after live review.
- **`overflow: hidden` on parent could clip the drawer.** MultiBadgeAnchor cell at L173 is `flex flex-col items-stretch` — no overflow clip. Should be safe. Verify.
- **Do NOT modify IdentityBadge.tsx.** Read-only per CONTEXT.md scope. Drawer treatment lives entirely on the appendage side.
- **Do NOT modify the meter well internals** (SEG_COUNT, segments, reset button, band computation). Byte-identical parity across surfaces — only corner-radius + border tokens change.
- **`z-index: 1` on drawer, pill's implicit stacking above via its own drop-shadow.** The pill's box-shadow at `IdentityBadge.tsx:121` (`0 8px 24px rgba(0,0,0,0.6)`) lands on the drawer. Do NOT set drawer to `z-index: 2` or above — inverts the layering.
- **Executor may fine-tune tuck depth** (6px / 8px / 10px) — CONTEXT D-12 permits, prototype uses 8px, RESEARCH recommends 8px verbatim.

---

### Finding 6 — Placeholder copy

#### `src/ui/features/pretty-view/PrettyView.tsx` (EXTEND-IN-PLACE — case-branch identityName)

**Analog (self):** The Phase 93 case-branch pattern at `PrettyView.tsx:4171` — `onOptimisticSend={source.kind === "relay" ? undefined : handleOptimisticSend}` — concentrates case-branching at the ComposeBox call site.

**Current shape (L4249):**
```tsx
identityName={pvIdentity?.displayName}
```

**Extension shape (Shape A — RECOMMENDED per RESEARCH § Finding 6):**
```tsx
identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}
```

**Result:** ComposeBox's template at L2750 (`placeholder={\`Message ${identityName || "Claude"}…\`}`) renders `Message room…` for relay-mode. Preserves capital-M convention of the harness template.

**Alternative (Shape B — inside ComposeBox):**
```tsx
// In ComposeBox.tsx L2750:
placeholder={mode === "relay" ? "Message room…" : `Message ${identityName || "Claude"}…`}
```

**Recommendation from RESEARCH:** Shape A. Concentrates case-branch discipline at the ComposeBox call site where all Phase 93 D-11 case-branches already live (`mode`, `canSend`, `onOptimisticSend`).

**Discipline (from RESEARCH landmines):**
- **Ellipsis is `…` U+2026, NOT three dots.** Preserve verbatim. Grep to confirm.
- **`Message` capital M** matches harness template convention. Ashley's shorthand `"message room"` was informality, not a design decision. Lock on `Message room…` (SOFT verify at plan-check per RESEARCH § Open Questions).
- **Do NOT change harness placeholder.** Regression floor.

---

### Finding 7 — URL persistence for relay rooms

#### `src/ui/lib/tab-url.ts` (EXTEND-IN-PLACE — widen grammar)

**Analog (self):** Existing `TabSpec` discriminated union at L43-47 + PROTOCOLS array at L73-79 + `parseTabParam` / `encodeTabSpec` / `specForTab` functions. Every session-tab URL round-trip is the template — mirror for relay.

**Analog excerpt (`TabSpec` at L43-47):**
```typescript
export interface TabSpec {
  protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet";
  host: string;
  session?: string;
}
```

**Analog excerpt (`PROTOCOLS` at L73-79):**
```typescript
const PROTOCOLS: TabSpec["protocol"][] = [
  "tmux",
  "terminal",
  "rdp",
  "vnc",
  "telnet",
];
```

**Analog excerpt (`parseTabParam` at L81-99):**
```typescript
export function parseTabParam(raw: string | null): TabSpec | null {
  if (!raw) return null;
  const idx1 = raw.indexOf(":");
  if (idx1 === -1) return null;
  const protocol = raw.slice(0, idx1) as TabSpec["protocol"];
  if (!PROTOCOLS.includes(protocol)) return null;
  const rest = raw.slice(idx1 + 1);
  if (protocol === "tmux") {
    const idx2 = rest.indexOf(":");
    if (idx2 === -1) return null;
    const host = decodeURIComponent(rest.slice(0, idx2));
    const session = decodeURIComponent(rest.slice(idx2 + 1));
    if (!host || !session) return null;
    return { protocol, host, session };
  }
  const host = decodeURIComponent(rest);
  if (!host) return null;
  return { protocol, host };
}
```

**Analog excerpt (`encodeTabSpec` at L101-107):**
```typescript
export function encodeTabSpec(spec: TabSpec): string {
  const parts = [spec.protocol, encodeURIComponent(spec.host)];
  if (spec.protocol === "tmux" && spec.session) {
    parts.push(encodeURIComponent(spec.session));
  }
  return parts.join(":");
}
```

**Analog excerpt (`specForTab` at L140-157):**
```typescript
export function specForTab(input: {
  type: TabType;
  host?: { name?: string; id?: string };
  targetTmuxSession?: string | null;
}): TabSpec | null {
  if (!input.host?.name) return null;
  const host = input.host.name;
  if (input.type === "terminal") {
    if (input.targetTmuxSession) {
      return { protocol: "tmux", host, session: input.targetTmuxSession };
    }
    return { protocol: "terminal", host };
  }
  if (input.type === "rdp" || input.type === "vnc" || input.type === "telnet") {
    return { protocol: input.type, host };
  }
  return null;
}
```

**Extension shape (widen TabSpec + PROTOCOLS + all three functions):**

```typescript
// 1. Widen TabSpec (L43-47):
export interface TabSpec {
  protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet" | "relay";
  host?: string;              // widened to optional — relay has no host
  session?: string;
  /**
   * Phase 97 Finding 7: opaque Matrix room ID. Populated ONLY when
   * protocol === "relay". Backend-side WS auth-gate validates whether the
   * caller has access to this room; unauthorized IDs emit an "inactive"
   * frame and the ChatSurfaceErrorState renders. Client does not double-
   * validate. Readability of the URL fragment is explicitly not a concern
   * (CONTEXT D-15).
   */
  roomId?: string;
}

// 2. Widen PROTOCOLS (L73-79):
const PROTOCOLS: TabSpec["protocol"][] = [
  "tmux",
  "terminal",
  "rdp",
  "vnc",
  "telnet",
  "relay",  // NEW
];

// 3. Widen parseTabParam (L81-99) — add relay branch before host-required
//    branches:
export function parseTabParam(raw: string | null): TabSpec | null {
  if (!raw) return null;
  const idx1 = raw.indexOf(":");
  if (idx1 === -1) return null;
  const protocol = raw.slice(0, idx1) as TabSpec["protocol"];
  if (!PROTOCOLS.includes(protocol)) return null;
  const rest = raw.slice(idx1 + 1);
  if (protocol === "relay") {
    const roomId = decodeURIComponent(rest);
    if (!roomId) return null;
    return { protocol: "relay", roomId };
  }
  if (protocol === "tmux") {
    // ... existing tmux branch unchanged ...
  }
  const host = decodeURIComponent(rest);
  if (!host) return null;
  return { protocol, host };
}

// 4. Widen encodeTabSpec (L101-107) — add relay branch:
export function encodeTabSpec(spec: TabSpec): string {
  if (spec.protocol === "relay") {
    if (!spec.roomId) return "";  // defensive; should never happen if TS types
                                   // are honored — a relay spec MUST have roomId
    return `relay:${encodeURIComponent(spec.roomId)}`;
  }
  const parts = [spec.protocol, encodeURIComponent(spec.host ?? "")];
  if (spec.protocol === "tmux" && spec.session) {
    parts.push(encodeURIComponent(spec.session));
  }
  return parts.join(":");
}

// 5. Widen specForTab (L140-157) — accept sessionKind + relayRoomId:
export function specForTab(input: {
  type: TabType;
  host?: { name?: string; id?: string };
  targetTmuxSession?: string | null;
  sessionKind?: "harness" | "relay-room";
  relayRoomId?: string;
}): TabSpec | null {
  // Phase 97 Finding 7: relay-room tabs have no fleet host — the room
  // lives on the Matrix relay. Route via sessionKind BEFORE the host-name
  // required check.
  if (input.sessionKind === "relay-room") {
    if (!input.relayRoomId) return null;
    return { protocol: "relay", roomId: input.relayRoomId };
  }
  if (!input.host?.name) return null;
  const host = input.host.name;
  if (input.type === "terminal") {
    if (input.targetTmuxSession) {
      return { protocol: "tmux", host, session: input.targetTmuxSession };
    }
    return { protocol: "terminal", host };
  }
  if (input.type === "rdp" || input.type === "vnc" || input.type === "telnet") {
    return { protocol: input.type, host };
  }
  return null;
}
```

**Discipline (from RESEARCH landmines):**
- **Matrix room IDs contain non-URL-safe characters** (`!aBcDeF:matrix.example.com`). `encodeURIComponent` handles `!` `:` `.` `@` `#` correctly. Practical room IDs are ~40 chars; verify encoded length stays reasonable (< 2000 URL cap).
- **Backward compatibility.** Legacy URLs without `relay:` param still parse — the extension is additive.
- **Do NOT log the full room ID.** Adapter logs already include `roomId`; URL-restore logs should mask or truncate to localpart for defense-in-depth (V8 information-disclosure).

---

#### `src/ui/AppShell.tsx` (EXTEND-IN-PLACE — URL-sync input + tab-restore output)

**Analog #1 (self, URL-sync effect at L910-972):** Currently passes `{type, host, targetTmuxSession}` to `specForTab`. Widen to also pass `sessionKind` + `relayRoomId`.

**Current (L914-922):**
```typescript
for (const t of tabs) {
  const spec = specForTab({
    type: t.type,
    host: t.host,
    // Prefer the live tmux session name discovered post-connect
    // (patch #1) — it's what actually persists across reattaches.
    // Fall back to any explicit target the tab was opened with.
    targetTmuxSession: tmuxSessionNames[t.id] ?? t.targetTmuxSession,
  });
  if (!spec) continue;
  if (t.id === activeTabId) activeIndex = tabSpecs.length;
  tabSpecs.push(spec);
}
```

**Extension shape:**
```typescript
for (const t of tabs) {
  const spec = specForTab({
    type: t.type,
    host: t.host,
    targetTmuxSession: tmuxSessionNames[t.id] ?? t.targetTmuxSession,
    // Phase 97 Finding 7: pass sessionKind + relayRoomId so specForTab's
    // relay branch can emit `relay:<roomId>` for relay-room tabs.
    sessionKind: t.sessionKind,
    relayRoomId: t.relayRoomId,
  });
  if (!spec) continue;
  if (t.id === activeTabId) activeIndex = tabSpecs.length;
  tabSpecs.push(spec);
}
```

**Also widen `splitTreeFragment` callback (L933-950) — same fields passed to `specForTab`:**
```typescript
const splitTreeFragment = encodeSplitTreeToUrl(splitTree, (tabId) => {
  const t = tabs.find((tab) => tab.id === tabId);
  if (!t) return null;
  return specForTab({
    type: t.type,
    host: t.host,
    targetTmuxSession: t.targetTmuxSession ?? tmuxSessionNames[t.id],
    sessionKind: t.sessionKind,           // NEW
    relayRoomId: t.relayRoomId,           // NEW
  });
});
```

---

**Analog #2 (self, tab-restore loop at L1254-1318):** Currently maps each `TabSpec` through `openTab(host, wantType, ...)`. Widen to handle `protocol === "relay"` by calling `openTab(null, "terminal", ..., {sessionKind: "relay-room", relayRoomId, ...})`.

**Analog excerpt (existing session open at L1284-1292):**
```typescript
const newId = openTab(
  host,
  wantType,
  undefined,
  wantSession
    ? { targetTmuxSession: wantSession, label: wantSession }
    : undefined,
);
if (newId) openedIds.push(newId);
```

**Analog excerpt (`onRelayRoomRowClick` at `AppShell.tsx:2169-2176` — the reference open shape):**
```typescript
const newTabId = openTab(null, "terminal", undefined, {
  sessionKind: "relay-room",
  relayRoomId: row.roomId,
  relayRoomTitle: row.roomTitle ?? null,
  label: row.roomTitle ?? row.roomId,
  allowCreateTmux: false,
});
```

**Extension shape (add relay branch in tab-restore loop):**
```typescript
if (pending) {
  for (const spec of pending.tabs) {
    // Phase 97 Finding 7: relay-room tabs restore via openTab(null, "terminal", ..., {sessionKind: "relay-room", ...})
    // matching the onRelayRoomRowClick shape at AppShell.tsx:2169-2176.
    if (spec.protocol === "relay") {
      if (!spec.roomId) continue;
      // Look for existing restored relay-room tab with same roomId — reuse.
      const match = restoredTabs.find(
        (t) => t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId,
      );
      if (match) {
        openedIds.push(match.id);
      } else {
        const newId = openTab(null, "terminal", undefined, {
          sessionKind: "relay-room",
          relayRoomId: spec.roomId,
          // roomTitle unknown at restore time — useRelayAdapter will emit
          // the title later via the session frame. Label is roomId as a
          // loading placeholder.
          relayRoomTitle: null,
          label: spec.roomId,
          allowCreateTmux: false,
        });
        if (newId) openedIds.push(newId);
      }
      continue;  // skip the host-required logic below
    }
    // Existing branches — tmux / terminal / rdp / vnc / telnet — unchanged.
    const wantType: TabType =
      spec.protocol === "tmux" ? "terminal" : (spec.protocol as TabType);
    // ... existing host resolution + openTab call unchanged ...
  }
}
```

**Landmines from RESEARCH:**
- **`consumePendingWorkspace` is called ONCE per Chrome tab lifetime.** The relay-tab restore call must complete BEFORE any user interaction.
- **`splitTree` fragment encoding.** Verify `split-tree-url.ts` handles a relay-kind leaf correctly (positional resolver walks `pending.tabs`; relay protocol is just another entry). Grep-read during execution.
- **URL sync fires on every tabs / activeTabId change.** Do NOT trigger sync on `chatSurfaceAdapter.roomTitle` change (title landing later shouldn't cause URL rewrite). URL is keyed on `roomId` alone.
- **URL-restored room may error.** The existing `ChatSurfaceErrorState` overlay (Phase 93 Slice 6) handles `room-not-found` cleanly. No new work needed.

---

## Shared Patterns

### `source.kind === "relay"` / `mode === "relay"` case-discrimination (D-01/D-08 — Phase 93 lock)

**Source:** `src/ui/features/pretty-view/PrettyView.tsx:3539` (harness gate) + `PrettyView.tsx:3567` (relay gate) + `ComposeBox.tsx:2334` (mode-hide Row 1) + `ComposeBox.tsx:2908` (mode-hide Paperclip).

**Apply to:** every new case-branch in Phase 97:
- Finding 1 veil mount gate: `source.kind === "relay"` in the peer effect.
- Finding 2 tabId threading: no case-branch needed inside MultiBadgeAnchor (already only mounted in relay case).
- Finding 3 compose reflow: `mode !== "relay"` on `pl-11` gate; `mode === "relay"` for pebble headroom spacer.
- Finding 6 placeholder: `source.kind === "relay"` on `identityName` prop.

**Discipline:**
- Every case-based branch reads `source.kind` (PrettyView layer) or `mode` (ComposeBox layer). NEVER other fields for case detection.
- No accidental inheritance (D-01): any place the room case still looks or feels different from the session case in a way NOT gated on one of these predicates is a bug.

---

### Structured logging discipline (V8 information-disclosure mitigation — Phase 93 Landmine 6)

**Source:** `src/ui/features/pretty-view/sources/use-relay-adapter.ts` — every `console.info({...})` site.

**Apply to:** every new logging site in Phase 97:
- Finding 1: any new adapter log around `isMessagesLoaded` flip (RECOMMENDED: none — the existing `history_batch` handler already logs enough).
- Finding 2: `[pv-split-drop-diag]` diagnostic log in SplitView (temporary; may stay as ambient instrumentation).
- Finding 7: `[url-restore]` log at AppShell relay-tab restore call site.

**Pattern:**
```typescript
console.info({
  operation: "relay_room_url_restore",     // explicit slug
  roomIdLocalpart: extractLocalpart(roomId),  // truncated for defense-in-depth (V8)
  ok: true,                                 // never raw event / body / full roomId
});
```

**Forbidden tokens (preserve when adding logs):**
- `JSON.stringify(event)` on a raw WS frame or React SyntheticEvent.
- Logging raw message bodies.
- Logging the full room ID in URL-restore logs (localpart or truncated).

---

### Rules-of-hooks discipline (Phase 93 Landmines 4 + 5)

**Source:** `use-relay-adapter.ts:587-599 + 605-625` — two `useMemo`s BEFORE `if (source === null) return IDLE_STATE;` early-return at L631.

**Apply to:** Finding 1's `isMessagesLoaded` state addition.

**Discipline:**
- New `useState` for `isMessagesLoaded` MUST live above the L631 early-return.
- The returned shape memo at L605-625 MUST include `isMessagesLoaded` in both the object and the deps array — every field returned must be in deps (Phase 93 Landmine 4).
- Reset `isMessagesLoaded = false` alongside the existing `setIsReady(false)` reset (trace the reset site during execution).

---

### `encodeURIComponent` on Matrix identifiers (path-traversal defense-in-depth — Phase 93 pattern)

**Source:** `use-relay-adapter.ts` (path construction in participants REST + reset endpoints) + `AgentBadgeWithMeter.tsx:130`.

**Apply to:** Finding 7's URL encoding of `roomId` in `encodeTabSpec` + `parseTabParam`.

**Pattern:**
```typescript
`relay:${encodeURIComponent(spec.roomId)}`
// Decode:
const roomId = decodeURIComponent(rest);
```

**Discipline:** Matrix room IDs legitimately contain `!` and `:` which require percent-encoding. NEVER pass a raw room ID string into a URL fragment; NEVER take a raw URL segment as a roomId without `decodeURIComponent`.

---

### Harness case regression floor (D-01 no-accidental-inheritance — Ashley's `/close` yardstick)

**Source:** Phase 93 Landmine 7 + CONTEXT.md D-01 verbatim.

**Apply to:** EVERY slice in Phase 97.

**Regression gate:**
- Mount PrettyView with `source={{kind:"harness",...}}` → assert:
  1. Veil dismisses via existing `renderedState === "resolving"` gate (Finding 1 harness path).
  2. Single-badge mount unchanged, `tabId={tabId}` still wired (Finding 2 harness path).
  3. ComposeBox Row 1 + paperclip render normally in harness mode; no `pl-11` gutter change; QueuePlusTab pebble renders normally (Finding 3 harness path).
  4. MultiBadgeAnchor doesn't mount (Finding 4 impact scoped to relay).
  5. AgentBadgeWithMeter doesn't mount (Finding 5 impact scoped to relay).
  6. ComposeBox placeholder renders `Message <identityName>…` unchanged (Finding 6 harness path).
  7. URL for session tabs encodes as `tmux:<host>:<session>` unchanged (Finding 7 harness path).
- Run all `PrettyView*.test.tsx` files against the harness case.
- Zero diff in `PrettyView.test.tsx` snapshots.

**Non-negotiable — if a slice can't clear this gate, stop and rework.**

---

### Phase 93 post-close regression floor (Landmines 1-8 from RESEARCH)

**Source:** RESEARCH § Landmines / anti-patterns to watch for (Phase 93 regressions).

**Apply to:** Every slice. Cross-check against Phase 93 post-close commits (`9ceab1b0`, `9bc46e27`, `7943123f`, `145ed27c`).

**Specific things Phase 97 MUST NOT regress:**
1. `canSend` for relay case includes `source.kind === "relay"` override — `PrettyView.tsx:4204`.
2. Local pendingSends suppressed in relay mode — `PrettyView.tsx:4171` `onOptimisticSend={source.kind === "relay" ? undefined : handleOptimisticSend}`.
3. Relay adapter resets reconnect-attempts on WS open — `use-relay-adapter.ts:401-404`.
4. Memoize adapter return — `use-relay-adapter.ts:605-625` (any new field added must also be in `useMemo` deps).
5. Rules-of-hooks in adapter — new `useState` for `isMessagesLoaded` must live above the `if (source === null) return IDLE_STATE;` at L631.
6. Structured logs — no raw event body, ever. `{operation: "...", ...explicit-fields...}` shape only.
7. `ChatSurfaceErrorState` is an OVERLAY (scrim + card) above the message list, NOT a replacement. The Finding-1 veil is a similar scrim; do NOT conflate the two.
8. The two `useMemo`s in the adapter exist to prevent hook-order violations. Any Finding-1 addition to the adapter's return shape must respect this pattern.

---

## No Analog Found

None. Every operation in Phase 97 has an analog in either:
- The same file being extended (self-analog — case-branch is a Phase 93 pattern already present in the file), OR
- A sibling file that establishes the pattern (harness single-badge analog for Finding 2; existing URL round-trip for Finding 7), OR
- An external prototype for the visual pattern (Finding 5 — Variant A CSS in `meter-tasting.html`).

The single non-code analog is the meter-tasting HTML prototype (Finding 5); every code analog lives in the shipped tree.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (extension targets: PrettyView, ComposeBox, MultiBadgeAnchor, AgentBadgeWithMeter, sources/*)
- `src/ui/features/terminal/IdentityBadge.tsx` (drag-source contract reference)
- `src/ui/shell/SplitView.tsx` (drop-target listener reference — Finding 2 discovery)
- `src/ui/shell/tabUtils.tsx` (dispatcher — read for context, no changes)
- `src/ui/AppShell.tsx` (URL-sync + tab-restore extension surfaces for Finding 7)
- `src/ui/lib/tab-url.ts` (URL grammar extension surface for Finding 7)
- `src/types/ui-types.ts` (Tab.sessionKind / relayRoomId shape reference)
- `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html` (Finding 5 visual pattern reference)

**Files scanned (concrete Reads):**
- `chat-surface-source.ts` (full 80 lines)
- `use-harness-adapter.ts` (full 45 lines)
- `use-relay-adapter.ts` (targeted L390-509, L580-645 for state + flips + memo)
- `PrettyView.tsx` (targeted L1970-2020, L3530-3600, L3780-3910, L4240-4340)
- `ComposeBox.tsx` (targeted L2320-2680, L2680-2920 for Row 1 mode-gate + textarea `pl-11` + paperclip mode-gate)
- `MultiBadgeAnchor.tsx` (full 265 lines)
- `AgentBadgeWithMeter.tsx` (targeted L1-220 for props + appendage container)
- `IdentityBadge.tsx` (targeted L70-244 for drag-source contract + rootClassName)
- `SplitView.tsx` (targeted L265-370 for native drop-target + prev-zone log)
- `tab-url.ts` (full 322 lines)
- `AppShell.tsx` (targeted L900-972 for URL-sync, L1080-1330 for tab-restore, L2140-2220 for openTab call sites)
- `types/ui-types.ts` (targeted L200-232 for Tab.sessionKind shape)
- `meter-tasting.html` (targeted L150-230 for Variant A CSS)

**Pattern extraction date:** 2026-09-10
