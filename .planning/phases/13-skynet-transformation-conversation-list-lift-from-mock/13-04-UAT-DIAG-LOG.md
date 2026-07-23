---
phase: 13-skynet-transformation-conversation-list-lift-from-mock
plan: 04
type: uat-diagnostic
requirements: [SHAPE-05]
status: pre-UAT complete; blocked on Ashley live UAT of deployed Waves 1-3 + shell chrome
tags: [ui, uat, diagnostics, ready-dot, mobile-scroll, safe-area, phase-13]
generated: 2026-07-23T15:22:08Z
generated_by: executor (autonomous pre-UAT static-analysis pass, per Ashley's "go all the way through" directive)
---

# Phase 13 Plan 04 — Post-Lift UAT Diagnostic Log

**Purpose:** Post-Wave-1+2+3 static-analysis + UAT scaffold for 3 outstanding
observability items:

1. **SHAPE-05** — ready-for-attention dot visibility on active-set idle rows
2. **Mobile iPhone PWA scroll-freeze** on the conversation list
3. **`100dvh` / `100vh` safe-area padding escape** at AppShell → panel chain

**Structure:**
- **Section 1** — Automated diagnostic findings (executor's static-analysis
  pass; provisional verdicts for the 4 dot-visibility candidates + mobile
  scroll analysis + safe-area chain audit)
- **Section 2** — Ashley's UAT observations (TEMPLATE — Ashley fills after
  Waves 1-3 deploy and she uses the app on both desktop + iPhone PWA)
- **Section 3** — Route-back matrix (executor's exhaustive next-step
  enumeration for every combination of UAT findings)

**Scope Boundaries (locked before executor started):**
- `src/ui/features/terminal/Terminal.tsx` is **READ-ONLY** for this plan
  (Ship-of-Theseus preserved; even if the diagnostic finds a Terminal.tsx
  bug, the route-back matrix documents it but NO EDIT happens in Wave 4)
- No source edits in `src/` under Wave 4 — `files_modified` in the plan is
  docs-only (this log + a SUMMARY.md)
- Ashley's UAT observation sections in Section 2 are TEMPLATES — the executor
  does NOT invent Ashley's observations, only provides the scaffolding

---

## Section 1: Automated Diagnostic Findings (executor pre-UAT pass)

### 1A. Dot visibility (SHAPE-05) — 4-candidate static analysis

The `conversation-list-idle-vs-wip-state` bounty (now merged into master)
preserved 4 diagnostic candidates for the "dot not visible after clicking 3
conversations" failure mode. Post-Wave-1 lift may fix indirectly, but the
plan requires source-read verdicts on all 4 before Ashley UATs.

#### Candidate A: Terminal.tsx `isIdle` null-start (ticker not fired post-recreate?)

**Static-analysis pass:**

```
File: src/ui/features/terminal/Terminal.tsx
Lines 231-232: const [tmuxSessionName, setTmuxSessionName] = useState<string | null>(null);
Lines 245:     const [isIdle, setIsIdle] = useState<boolean | null>(null);
Lines 252-257: useEffect(() => {
                 const hostId = hostConfig.id;
                 if (hostId == null) return;
                 const key = `${hostId}:${tmuxSessionName ?? ""}`;
                 publishSessionWorking(key, isIdle === null ? null : isIdle === false);
               }, [isIdle, hostConfig.id, tmuxSessionName]);
Lines 1131-1139: if (msg.type === "idle") {
                   if (typeof msg.idle === "boolean") setIsIdle(msg.idle);
                   return;
                 }
Lines 1655-1659: if (msg.type === "tmux_session_created" || msg.type === "tmux_session_attached") {
                   const sessionName = typeof msg.sessionName === "string" ? msg.sessionName : "";
                   tmuxSessionNameRef.current = sessionName || "(active)";
                   setTmuxSessionName(tmuxSessionNameRef.current);
                   ...
                 }
```

**Findings:**

1. `isIdle` starts at `null`. It ONLY transitions on a backend WebSocket
   `{type:"idle", idle:bool}` frame (line 1136-1137). No client-side default
   / no initial "assume idle at connect" fallback.
2. `tmuxSessionName` starts at `null`. It ONLY transitions on
   `tmux_session_created` / `tmux_session_attached` backend frames
   (line 1659).
3. The `publishSessionWorking` effect at line 252-257 does publish immediately
   on mount because the effect runs after mount regardless of deps. But the
   published value on FIRST mount is: `key = "${hostId}:"` (empty tmux
   session), value = `null` (isIdle is null). This means the store gets an
   entry at key `${hostId}:` set to `null`.
4. AFTER `setTmuxSessionName("actualName")` fires (backend frame), the effect
   re-runs with `key = "${hostId}:actualName"` and value = still `null`.
   So the store now has TWO entries:
   - `${hostId}:` → `null` (leftover from mount before tmux attached)
   - `${hostId}:actualName` → `null` (post-tmux-attach)
5. Then the backend fires `{type:"idle", idle:true}` (Claude is at a prompt),
   which triggers `setIsIdle(true)` → effect re-runs → publishes
   `${hostId}:actualName` → `false` (isIdle===true means NOT working, so
   published as `false`).
6. From this moment forward, the row's `useSessionWorking(sessionKey)` where
   `sessionKey = ${row.host.id}:${row.targetTmuxSession ?? ""}` will resolve
   correctly IFF `row.targetTmuxSession === tmuxSessionName` (the actual name
   the backend gave, not just what the Tab was opened with).

**PROVISIONAL VERDICT: SUSPECT — mount-time race window + key-format
alignment dependency.**

**Root failure modes hidden in this path:**

- **A.1 (Startup null-start):** If Ashley clicks a row, Terminal.tsx mounts,
  WS opens, but the backend has NOT yet sent an `{type:"idle"}` frame before
  she clicks a 2nd row, isIdle stays null → published value stays null →
  the store returns null → dot NEVER shows on the first row until the
  backend eventually publishes idle. If Claude is genuinely working when
  the pane opens, this is correct behavior. But if Claude is IDLE at the
  prompt when the pane opens, the row won't show a dot until the backend
  emits an initial `{type:"idle", idle:true}` frame. Question for Ashley:
  does the backend emit an initial-state frame on WS attach, or only on
  transitions? (Comment at Terminal.tsx:241 says "plus an initial state on
  WS attach" but no runtime observation confirms this.)

- **A.2 (Recreate / remount stall):** If a route change causes Terminal.tsx
  to UNMOUNT and REMOUNT, the store still has the last-published value
  for that key (session-working-store.ts line 74-81: publishing null after
  a boolean does overwrite; nothing DELETES the key). So a remount that
  publishes null (during the mount race window before the backend frame
  arrives) will OVERWRITE any prior boolean value with null → dot goes
  AWAY until the next backend frame. session-working-store.ts:70 comment
  says "publishing null OVERWRITES to null (does NOT delete the key).
  Rationale: a re-mount observing null after a known transition is
  semantically correct". Confirmed by static analysis: this is
  DELIBERATE behavior.

- **A.3 (No cleanup effect):** The publishSessionWorking useEffect at line
  252-257 has NO cleanup function. Terminal.tsx comment at line 250 says
  "deliberately NO cleanup — preserve last-known state across route
  changes so a remount doesn't stall on null waiting for the next backend
  frame." — GOOD. This means when Terminal.tsx unmounts (e.g. Ashley
  clicks away), the last-known isIdle stays published in the store,
  keeping the row's dot visible until the NEXT mount republishes.
  Consistent with the design intent.

**Recommended Ashley runtime verification:**
Open DevTools console and paste:
```js
// After clicking 3 conversations
import.meta.hot?.data ?? null;
// Then run this in the console:
console.table([...window.__PV_DIAG__?.() ?? []]);
```
(Note: no debug hook currently exists; would need adding — see route-back
matrix. Alternative: `document.querySelectorAll('[data-pv-conv-ready-dot]').length`
after clicking 3 idle-state conversations should return 3.)

#### Candidate B: sessionWorkingKey mismatch (`row.targetTmuxSession` null vs Terminal publishing real tmuxSessionName)

**Static-analysis pass:**

```
File: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
Lines 67-70: function sessionWorkingKey(row: ConversationRowShape): string | null {
               if (!row.host) return null;
               return `${row.host.id}:${row.targetTmuxSession ?? ""}`;
             }

File: src/ui/features/terminal/Terminal.tsx
Line 253-256: const hostId = hostConfig.id;
              if (hostId == null) return;
              const key = `${hostId}:${tmuxSessionName ?? ""}`;
              publishSessionWorking(key, ...);
```

**Findings:**

1. **Format alignment:** Both sides use the format `${hostId}:${tmuxSessionName ?? ""}`.
   Same delimiter (`:`), same null-fallback (empty string). **Formats align.**
2. **hostId type alignment:** `Host.id` in ui-types.ts:2 is typed as `string`.
   Both `row.host.id` (Panel side) and `hostConfig.id` (Terminal side) refer
   to the same `Host.id` string. **Types align.**
3. **Value alignment (the tricky part):**
   - **Terminal side**: publishes with `tmuxSessionName` from React state,
     which is set from backend `msg.sessionName` on `tmux_session_attached` /
     `tmux_session_created` (Terminal.tsx:1655-1659). Backend sends the
     ACTUAL tmux session name (e.g. `"claude-agent-1"`) or empty string
     coerced to `"(active)"` (line 1658).
   - **Panel side**: reads `row.targetTmuxSession` from the ConversationRow.
     ConversationRow's `targetTmuxSession` is set from `Tab.targetTmuxSession`
     (conversation-store.ts:220). What does `Tab.targetTmuxSession` hold?
     It's set by the code that OPENS the tab — i.e., by whatever called
     `openTab(host, "terminal", { targetTmuxSession: X })`. In the fleet-
     discovery flow (Plan 07-01), fleet-derived synthetic rows carry
     `targetTmuxSession: session.sessionName` (conversation-store.ts:336).
     In the tab-opened-by-picker flow, it's whatever the user chose.
   - **Potential mismatch:** If a Tab is opened with `targetTmuxSession=null`
     (e.g. fresh terminal without a specific session pick), the row's key
     resolves to `${hostId}:` (empty). But once Terminal.tsx attaches and
     the backend responds with the session name it created/attached to,
     the publish key becomes `${hostId}:actualName`. The row is looking at
     `${hostId}:` but Terminal is publishing at `${hostId}:actualName`.
     **KEY MISMATCH POSSIBLE in the "opened without pre-picked tmux session"
     path.**
4. **In the fleet-derived synthetic rows path** (rows Ashley sees for
   sessions on other machines that she hasn't attached to yet), the row
   carries `targetTmuxSession: session.sessionName`, so the key aligns.

**PROVISIONAL VERDICT: MISMATCH DETECTED for the "Tab opened without pre-
picked tmux session" code path; PASS for fleet-derived synthetic rows.**

**Root failure modes:**

- **B.1 (Fresh-terminal path):** Ashley opens a NewSessionDialog, picks a
  host, DOESN'T specify a tmux session (backend picks one). Tab is created
  with `targetTmuxSession: null`. Row's key = `${hostId}:`. Terminal
  attaches, backend responds with `sessionName="whatever"`, Terminal
  publishes `${hostId}:whatever`. Row's `useSessionWorking(${hostId}:)`
  never sees the boolean the store has at `${hostId}:whatever`. **Dot never
  shows on this row until Ashley reloads and the row is re-derived from
  the updated Tab.**

  BUT — do we ever update `Tab.targetTmuxSession` after the fact? Let me
  check: Terminal.tsx line 1661 calls `onTmuxSessionChange?.(sessionName)` —
  a callback that MIGHT propagate up to the parent (which manages
  openTabs). If AppShell wires this to update the Tab's targetTmuxSession
  in openTabs, then the row would re-derive with the correct key on the
  next store notify. **Needs runtime confirmation.**

- **B.2 (Session-picked path):** Ashley opens a NewSessionDialog and PICKS
  a specific tmux session (e.g. "claude-agent-1"). Tab is created with
  `targetTmuxSession: "claude-agent-1"`. Row's key = `${hostId}:claude-agent-1`.
  Terminal attaches, backend responds with `sessionName="claude-agent-1"`,
  publishes at same key. **Keys align — dot works.**

- **B.3 (Fleet-discovery path):** Row was auto-synthesized from a
  FleetSession, `targetTmuxSession: session.sessionName`. If Ashley
  clicks the row, openTab is called with that same sessionName. Key
  aligns. **Dot works.**

**Recommended Ashley runtime verification:**
1. Open a NewSessionDialog, pick a host, do NOT specify a tmux session
   (let backend pick one).
2. After Claude is idle at the prompt, check if the row shows a dot.
3. If NOT: Candidate B.1 confirmed — fresh-terminal path has a key
   mismatch bug.

#### Candidate C: activeSet sessionStorage populate on fresh session

**Static-analysis pass:**

```
File: src/ui/state/conversation-store.ts
Lines 110-130: const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";
               function hydrateActiveSetFromStorage(): Set<string> {
                 try {
                   if (typeof sessionStorage === "undefined") return new Set<string>();
                   const raw = sessionStorage.getItem(ACTIVE_SET_STORAGE_KEY);
                   if (!raw) return new Set<string>();
                   const parsed = JSON.parse(raw);
                   if (!Array.isArray(parsed)) return new Set<string>();
                   const out = new Set<string>();
                   for (const v of parsed) if (typeof v === "string") out.add(v);
                   return out;
                 } catch {
                   return new Set<string>();
                 }
               }
Line 176: activeSet: hydrateActiveSetFromStorage(),  // module-load time
Lines 646-662: export function addToActiveSet(id: string): void {
                 if (state.activeSet.has(id)) return;
                 const nextActiveSet = new Set(state.activeSet);
                 nextActiveSet.add(id);
                 try {
                   if (typeof sessionStorage !== "undefined") {
                     sessionStorage.setItem(ACTIVE_SET_STORAGE_KEY, JSON.stringify([...nextActiveSet]));
                   }
                 } catch {}
                 state = { ...state, activeSet: nextActiveSet };
                 notify();
               }
Lines 609-615: // Patch #137: every non-null selection is an active-set engagement signal —
               // record it BEFORE the same-selectedId short-circuit ...
               if (id !== null) addToActiveSet(id);
```

**Findings:**

1. `hydrateActiveSetFromStorage()` is called **synchronously at module load
   time** (line 176). This means when the JS bundle first executes,
   `state.activeSet` is populated from sessionStorage before ANY React
   component renders. **No race with first render.**
2. `addToActiveSet(id)` is called from `selectConversation(id)` (line 615)
   for every non-null id. This fires synchronously on every row click.
3. `useActiveSet()` returns a stable `ReadonlySet<string>` reference that
   flips on every mutation (line 732-741). Panel's `activeSet.has(row.id)`
   read at PrettyConversationsPanel.tsx:327,372,398 reads from this stable
   snapshot.
4. **Fresh browser session, first page load, no sessionStorage entry yet**:
   activeSet starts as empty Set. Ashley clicks Row A → `selectConversation`
   → `addToActiveSet('A')` → activeSet = `{'A'}` → sessionStorage updated
   → notify() → panel re-renders with `activeSet.has('A') === true`.
   Row A now carries `.active-set` class → dot can render.
5. **Page reload after Ashley has clicked 3 conversations**: sessionStorage
   still has `["A","B","C"]` (sessionStorage persists across page reloads
   within the same tab). Module-load hydrate populates activeSet = `{A,B,C}`.
   First render: all 3 rows carry `.active-set`. Dot renders on all 3
   (assuming isWorking===false).
6. **Cross-tab isolation**: sessionStorage is per-tab. Opening a new tab
   starts with empty activeSet. Correct semantics.

**PROVISIONAL VERDICT: PASS — activeSet populates synchronously at module
load; no race window with first render; sessionStorage rehydration correct.**

**No known failure modes in this candidate.** The only edge case is
sessionStorage being unavailable (SSR / JSDOM / quota exceeded) — silently
falls back to empty Set, then addToActiveSet works in-memory only. In
Ashley's iPhone Safari PWA, sessionStorage is standard and available.

#### Candidate D: PrettyConversationRowLive Rules-of-Hooks compliance

**Static-analysis pass:**

```
File: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
Lines 78-99:
  function PrettyConversationRowLive(props: {...}) {
    const { sessionKey, inActiveSet, ...rowProps } = props;
    const isWorking = useSessionWorking(sessionKey);          // ← hook call
    return (
      <PrettyConversationRow
        {...rowProps}
        isWorking={isWorking}
        inActiveSet={inActiveSet}
      />
    );
  }

File: src/ui/state/session-working-store.ts
Lines 89-99: export function useSessionWorking(key: string | null): boolean | null {
               const getSnapshot = (): boolean | null => {
                 if (key === null) return null;
                 const v = state.map.get(key);
                 return v === undefined ? null : v;
               };
               return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
             }
```

**Findings:**

1. `PrettyConversationRowLive` is called from three sites in
   PrettyConversationsPanel.tsx (lines 313, 364, 384), each with a stable
   `key={row.id}` prop. React reconciles the component instance to the
   same row across renders, so the hook order for this instance is
   consistent.
2. Inside the component body: `useSessionWorking(sessionKey)` is called
   AT THE TOP, before any early return, conditional, or loop. Only
   preceded by a destructure (line 90) which is not a hook call.
3. Inside `useSessionWorking`: the `getSnapshot` closure and
   `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` are ALWAYS
   called unconditionally. The `key === null` check happens INSIDE the
   snapshot closure at getSnapshot invocation time, not before the hook.
   This is textbook Rules-of-Hooks compliance — the null short-circuit is
   at data-flow level, not at hook-call level.
4. `PrettyConversationRow` (called from `PrettyConversationRowLive`'s
   return) contains further hooks (`useState`, `useRef`, `useCallback`) —
   but these are inside a nested component, not adjacent to
   `useSessionWorking` at the same nesting level. No conditional hook
   calls in `PrettyConversationRow` itself either (verified in Row.tsx).

**PROVISIONAL VERDICT: PASS — PrettyConversationRowLive is fully Rules-of-
Hooks compliant. No conditional hook calls. useSessionWorking is called
unconditionally at the top of the component body. useSyncExternalStore is
called unconditionally inside useSessionWorking.**

**No known failure modes in this candidate.**

#### 4-candidate summary table

| Candidate | Location | Provisional Verdict | Primary Failure Mode Hypothesis |
|-----------|----------|----|----|
| A. Terminal.tsx isIdle null-start | Terminal.tsx:245,252-257,1131-1139 | SUSPECT | A.1: no client-side "assume idle at connect" fallback → dot won't show until backend fires first `{type:"idle"}` frame |
| B. sessionWorkingKey mismatch | PrettyConversationsPanel.tsx:67-70; Terminal.tsx:255 | MISMATCH DETECTED (fresh-terminal path) | B.1: Tab opened with `targetTmuxSession=null` but Terminal.tsx publishes at real backend sessionName → keys diverge → dot never shows |
| C. activeSet sessionStorage populate | conversation-store.ts:117-130,176,646-662 | PASS | No known failure mode; synchronous hydrate + idempotent adds + stable Set identity |
| D. PrettyConversationRowLive Rules-of-Hooks | PrettyConversationsPanel.tsx:78-99 | PASS | No conditional hooks; unconditional useSyncExternalStore in useSessionWorking |

**Wave 1 impact assessment:** The Wave 1 row rewrite emits the same conditional
`{inActiveSet && isWorking === false && <span ... />}` as the pre-lift version
(PrettyConversationRow.tsx:407-420). Wave 1 does NOT directly fix any of the 4
candidates — it may have removed noise (JS-computed inline styles that
interfered with layout) but the JS-gate on the dot render is unchanged.

### 1B. Mobile iPhone PWA scroll-freeze

**Static-analysis pass:**

```
File: src/ui/features/pretty-conversations/PrettyConversationRow.tsx
Line 151-165: const onTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
                if (isRdp) return;
                if (!isMobile) return;
                const t = e.touches[0];
                if (!t) return;
                startXRef.current = t.clientX;
                startYRef.current = t.clientY;
                baseDxRef.current = effectiveOpen ? -PC_SWIPE_REVEAL : 0;
                activeRef.current = true;
                // Do not preventDefault — passive-friendly. Native vertical scroll wins
                // for a vertical drag; we only track horizontal.
              }, [isRdp, isMobile, effectiveOpen]);

Line 167-189: const onTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
                ...
                const dy = Math.abs(t.clientY - startYRef.current);
                if (dy > PC_SWIPE_ANGLE_TOLERANCE) {
                  // Vertical gesture — yield to browser scroll and abort the swipe.
                  activeRef.current = false;
                  setDxLive(null);
                  return;
                }
                const raw = t.clientX - startXRef.current;
                const clamped = Math.max(-PC_SWIPE_REVEAL, Math.min(0, baseDxRef.current + raw));
                setDxLive(clamped);
              }, [isRdp, isMobile]);

Line 334-337:  onTouchStart={isMobile && !isRdp ? onTouchStart : undefined}
              onTouchMove={isMobile && !isRdp ? onTouchMove : undefined}
              onTouchEnd={isMobile && !isRdp ? onTouchEnd : undefined}
              onTouchCancel={isMobile && !isRdp ? onTouchEnd : undefined}
```

**Findings:**

1. **preventDefault call site count in PrettyConversationRow:** 1 (line 225,
   inside `onBodyKeyDown` for Enter/Space keyboard handler). **Zero calls
   to preventDefault in touch handlers.** Comment at line 161 explicitly
   documents this design intent: "Do not preventDefault — passive-friendly.
   Native vertical scroll wins for a vertical drag; we only track
   horizontal."
2. **Vertical-scroll bail-out:** onTouchMove line 175-180 checks
   `dy > PC_SWIPE_ANGLE_TOLERANCE`, and if so, aborts the swipe state
   machine and returns early. This means the native browser vertical
   scroll takes over. **Should not freeze.**
3. **touch-action CSS declaration:** grep for `touch-action` in
   `pretty-conversations.css` returns **0 hits**. Wave 1 did NOT add a
   `touch-action: pan-y` declaration. Also 0 hits in
   PrettyConversationRow.tsx. So the row's default touch-action is
   `auto` (browser default). This is what pre-Wave-1 had too.
4. **Scroll container:** PrettyConversationsPanel.tsx:275 uses
   `overflow-y-auto` (Tailwind: `overflow-y: auto`). No
   `overscroll-behavior` declaration anywhere. This means iOS Safari's
   default `overscroll-behavior-y: auto` applies — the scroll can
   bubble to the parent (AppShell's `100dvh` container), which is
   fine as long as the parent doesn't also scroll.
5. **AppShell container:** Line 1400-1405 the outer wrapper is
   `<div className="flex w-screen bg-background" style={{ height: "100dvh", paddingTop: "max(env(safe-area-inset-top), 0px)" }}>`.
   `bg-background` is a Tailwind class but the outer wrapper doesn't set
   `overflow-y`, so it defaults to `visible`. Body/html don't scroll on
   PWA because `100dvh` fills the viewport exactly. The scroll region
   is genuinely the `.overflow-y-auto` panel.
6. **Wave 1 vs pre-Wave-1 comparison:**
   - Pre-Wave-1 row had many `flex-1 min-w-0 flex flex-col gap-0.5`
     Tailwind classes + JS-computed inline styles. These did not add
     touch handlers or touch-action.
   - Wave 1 row has raw CSS from `.pv-row` + `.pv-body` etc. These
     also do not add touch handlers or touch-action.
   - **No functional change in touch handling.** If scroll-freeze
     reproduced pre-Wave-1, it will likely reproduce post-Wave-1.

**PROVISIONAL VERDICT: UNCHANGED FROM PRE-WAVE-1 — Wave 1 did not add
`touch-action: pan-y` or otherwise change the touch handler strategy;
freeze may still reproduce. If Ashley confirms scroll works, no action
needed (touch handler bail-out at line 175 is enough). If it still
freezes, the recommendation is to add `.pv-row { touch-action: pan-y; }`
to pretty-conversations.css to explicitly permit vertical browser scroll
and constrain to horizontal swipe.**

**Root failure modes hidden:**

- **1B.1 (Angle tolerance too tight):** If `PC_SWIPE_ANGLE_TOLERANCE` is
  too tight (e.g. 8-12 px), an actual vertical scroll gesture starting
  with a small dx from finger placement won't hit the "vertical bail-out"
  threshold before Ashley has moved enough to feel scroll-lock. Value
  should be checked (Wave 1 preserved it from pre-Wave-1). Need Ashley's
  UAT to say whether freeze is "instant lock" (angle-tolerance too tight)
  or "brief hitch" (React re-render pause during dxLive updates) or
  "no freeze at all" (Wave 1 obviated).

- **1B.2 (React re-render pauses during onTouchMove):** Line 186
  `setDxLive(clamped)` triggers a React re-render on every touchmove
  frame during a horizontal swipe. If iOS Safari's touchmove event
  frequency exceeds React's ability to update the transform in the
  next frame, the scroll can appear janky. But this only applies to
  HORIZONTAL swipes on the row body, not vertical scroll of the panel.

- **1B.3 (Safari PWA quirk):** iOS Safari PWA has known quirks with
  100dvh + backdrop-filter combined + scroll containers. The row has
  `backdrop-filter: blur(20px) saturate(1.5)` in its base state. If
  Safari's Metal compositor renders each row's backdrop-filter on the
  main thread, scrolling through 20+ rows can trigger a stutter that
  Ashley perceives as freeze. Ashley's DevTools trace would confirm
  or reject this.

### 1C. `100dvh` / `100vh` safe-area padding escape

**Static-analysis pass:**

```
File: src/ui/AppShell.tsx
Line 1403: height: "100dvh",
Line 1404: paddingTop: "max(env(safe-area-inset-top), 0px)",
Line 1472: top: "max(env(safe-area-inset-top), 8px)",  // (chevron button)
Line 1532: style={{ height: "100dvh" }}  // (mobile Sheet content)
Line 1554: style={{ height: "100dvh" }}  // (mobile list screen full-viewport column)

File: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
Line 233: className="relative flex flex-col flex-1 min-h-0 overflow-hidden pb-[env(safe-area-inset-bottom)]"
```

**Findings:**

1. **3 `100dvh` sites in AppShell:**
   - **1400 outer wrapper (root shell):** applies `paddingTop:
     max(env(safe-area-inset-top), 0px)` at line 1404 to push the
     content below the top safe-area strip. But **there is NO
     `paddingBottom: max(env(safe-area-inset-bottom), 0px)`** on
     this wrapper.
   - **1532 mobile Sheet content:** height 100dvh, NO paddingBottom.
     But this is a Sheet portaled at document root, so its safe-area
     handling is independent — shadcn Sheet defaults should apply.
   - **1554 mobile list screen wrapper:** `<div className="flex flex-col flex-1 min-w-0 bg-sidebar" style={{ height: "100dvh" }}>`.
     No paddingBottom on this either.

2. **The `pb-[env(safe-area-inset-bottom)]` workaround at
   PrettyConversationsPanel.tsx:233 is on the PANEL container** —
   `<div className="relative flex flex-col flex-1 min-h-0 overflow-hidden pb-[env(safe-area-inset-bottom)]" ...>`.
   This adds bottom padding INSIDE the panel container so its inner
   `.overflow-y-auto` scroller (line 275) doesn't run its content
   below the iPhone home indicator.

3. **The root cause chain:**
   - AppShell outer wrapper: `height: 100dvh` + `paddingTop:
     max(env(safe-area-inset-top), 0px)`. The outer wrapper's INTERIOR
     height = 100dvh minus top safe-area = the visible content area
     ABOVE the home indicator.
   - Wait — 100dvh is the "dynamic viewport height" which by CSS spec
     INCLUDES the safe-area regions (unlike 100lvh which excludes them
     when the browser chrome is showing). So `height: 100dvh` sets the
     wrapper to the FULL viewport height including where the home
     indicator overlays.
   - `paddingTop: max(env(safe-area-inset-top), 0px)` correctly
     compensates for the TOP safe-area. But the BOTTOM safe-area is
     NOT compensated on the outer wrapper. This means the outer
     wrapper's content area extends BEHIND the home indicator by
     `env(safe-area-inset-bottom)` px.
   - The panel container (line 233) has `flex-1 min-h-0 overflow-hidden`
     — it fills the parent's content area, which extends behind the
     home indicator. The `pb-[env(safe-area-inset-bottom)]` workaround
     adds internal padding so the scroller's content ends ABOVE the
     home indicator.

4. **Wave 2 impact on chevron area:** Wave 2 rebased the chevron button's
   className (transparent bg + rounded-md 8px + `--color-pv-fg-muted`
   icon). It did NOT touch the outer wrapper's `100dvh` +
   `paddingTop: max(env(safe-area-inset-top), 0px)` styling — those
   are on the OUTER `<div>` at line 1400, not on the chevron button.
   **Wave 2 did NOT change the safe-area escape situation at
   AppShell.**

5. **Alternative fix path (not this plan):** Add `paddingBottom:
   max(env(safe-area-inset-bottom), 0px)` to AppShell.tsx:1400's
   outer wrapper. This would compensate for the bottom safe-area at
   the ROOT of the shell, making the interior content area truly
   equal to the visible content area. Then the panel's
   `pb-[env(safe-area-inset-bottom)]` workaround becomes REDUNDANT
   and can be reverted. **BUT: this changes AppShell layout beyond
   just the chevron, and Wave 2 SHAPE-04's plan explicitly limited
   AppShell scope to "the chevron area only." Route-back would be a
   follow-up plan (13-05+ or master bounty task).**

**PROVISIONAL VERDICT: WORKAROUND STILL NEEDED — Wave 2 did not touch the
`100dvh` + missing `paddingBottom` chain. The `pb-[env(safe-area-inset-bottom)]`
workaround at PrettyConversationsPanel.tsx:233 is the current mitigation. It
CAN be reverted only after a follow-up plan adds `paddingBottom:
max(env(safe-area-inset-bottom), 0px)` to AppShell.tsx:1400.**

**This is a nice-to-have per SHAPE-04 — the workaround is functionally
correct; it just puts the safe-area compensation at the wrong architectural
layer. Not phase-blocking. Should be tracked in the master bounty for a
future patch.**

### 1D. Additional pre-UAT signals (not in the plan's original 3-item scope)

**CSS specificity check on `.pv-ready-dot`:**

```
File: src/ui/features/pretty-conversations/pretty-conversations.css
Lines 271-281: .pv-ready-dot { ...visual... display: none; }
Lines 284-286: .pv-row.active-set:not(.working) .pv-ready-dot { display: block; }

File: src/ui/features/pretty-conversations/PrettyConversationRow.tsx
Lines 407-420: {inActiveSet && isWorking === false && (
                 <span ... className="pv-ready-dot" style={{ display: "block" }} />
               )}
```

**Findings:**

1. The `.pv-ready-dot` base rule sets `display: none`. Specificity: 0,1,0
   (1 class).
2. The `.pv-row.active-set:not(.working) .pv-ready-dot` rule sets
   `display: block`. Specificity: 0,3,0 (3 classes).
3. The inline `style={{ display: "block" }}` on the span (line 418) has
   specificity 1,0,0,0 (inline style beats all classes). Comment at line
   413-417 explains why: to guarantee visibility even when the CSS `active-set`
   toggle is somehow missing from the parent.
4. **CSS specificity war RISK NONE:** Inline style always wins. If the span
   renders, it's visible.
5. **Conclusion:** IF the JS-gate condition `inActiveSet && isWorking === false`
   evaluates to true, the dot renders with inline `display: block` and IS
   visible. The failure mode is exclusively at the JS-condition level
   (Candidate A or B), NOT at the CSS level.

**Ashley's DevTools verification:**
```js
document.querySelectorAll('[data-pv-conv-ready-dot="true"]').length
```
This queries by the data attribute set at line 410, regardless of computed
display. If this returns 0 after clicking 3 conversations that are all idle,
the JS-condition (Candidate A or B) is the culprit. If it returns 3 but
none are visible, CSS is the culprit (would be surprising given the inline
`display: block`).

**Terminal.tsx WS connect / disconnect impact on published state:**

Static analysis: no cleanup effect in the publishSessionWorking useEffect
(Terminal.tsx:252-257). This is DELIBERATE per comment at line 250. So when
Ashley closes a Terminal.tsx-mounted pane, the last-known `isWorking` value
STAYS in the store. If she re-selects the same conversation later, the row's
dot state will match the last-known value until the next backend frame updates
it. This is CORRECT behavior — the store deliberately doesn't leak "unknown"
state through the pause.

**Fleet-derived row edge case:**

Rows synthesized from a FleetSession (Ashley sees these for tmux sessions on
hosts she hasn't attached to yet) carry `targetTmuxSession: session.sessionName`
(conversation-store.ts:336). BUT Terminal.tsx doesn't publish for a session
Ashley hasn't opened (Terminal.tsx isn't mounted). So `useSessionWorking` returns
`null` for these rows → the row's condition `isWorking === false` is false →
dot never renders. **This is CORRECT semantics per Ashley's v4 lock: dot
means "in Ashley's active-set AND agent is idle." Fleet-only rows are NOT in
her active-set (she hasn't clicked them). So they're .ambient anyway, and
`.ambient` rows never carry `.active-set`, so the CSS selector doesn't fire
either.**

**No additional Wave-1-driven diagnostic signal found.**

---

## Section 2: Ashley's UAT Observations (TEMPLATE — Ashley fills after UAT)

### 2.0 Deployment preflight (Ashley checks BEFORE UAT)

- [ ] Waves 1-3 shipped to term.gigaashley.click (or local `npm run dev` if
      running against a workstation build)
- [ ] Ashley freshly reloads the page (Cmd+R desktop / iOS reload PWA) to
      clear stale sessionStorage / activeSet from prior sessions
- [ ] The 15-min deadman rollback timer (`/opt/termix/.tmp-revert.sh`) is
      armed if deploying to prod

**Deployment status:** _(Ashley: fill after deploy)_

### 2A. Overall visual parity with mock v4 (SHAPE-01/02/03/04 sanity)

**How to check:**
1. Open the conversation list side-by-side with
   `~/.claude/identities/tina/bounties/skynet-transformation/prototype.html`
   (Full-intensity + Normal density variant)
2. Compare:
   - Warm-cream rows with hue-tinted bubbles for active-set rows
   - Ambient recession for out-of-set rows (visible but recessed)
   - UPPERCASE panel-header title
   - Transparent pencil button (32x32, no fill, no border)
   - Bare-icon pin with hue-drop-shadow on pinned rows

**Ashley fills after live UAT:**

| Item | Verdict | Notes |
|------|---------|-------|
| Row treatment (active-set full bubble) | _PASS / DIFFERENCE_NOTED_ | |
| Row treatment (ambient recession) | _PASS / DIFFERENCE_NOTED_ | |
| Panel header (UPPERCASE title + transparent pencil) | _PASS / DIFFERENCE_NOTED_ | |
| PinAction (bare icon with hue-drop-shadow when pinned) | _PASS / DIFFERENCE_NOTED_ | |
| AppShell chevron (mock pencil aesthetic) | _PASS / DIFFERENCE_NOTED_ | |

**Ashley's overall verdict:** _PASS / DIFFERENCE_NOTED (with specific delta)_

### 2B. Ready-for-attention dot visibility (SHAPE-05 — PRIMARY VERIFICATION)

**How to check (freshly-reloaded browser, empty activeSet):**

1. Cmd+R / iOS reload the page. Verify activeSet starts empty (no rows
   should have the full-bubble treatment yet; all should be ambient).
2. Click into Row A (any conversation, ideally one with an idle Claude
   pane at the prompt). Ashley Prime or similar known-idle identity.
3. Verify Row A now shows: (a) full-bubble treatment (not ambient),
   (b) a bright hue-cream ready-dot in its `.pv-meta` column (right
   side) — IF the agent is idle. If the agent is working, no dot yet.
4. Click into Row B (a different conversation).
5. Repeat: verify Row B shows full-bubble + dot (if idle).
6. Click into Row C (a third conversation).
7. Repeat.
8. Rows NOT clicked this session should stay ambient and show NO dot
   regardless of their agent state.

**Ashley fills after live UAT:**

| Row clicked | Was agent idle? | Row went to full-bubble? | Ready-dot visible? | Notes |
|-------------|-----------------|--------------------------|--------------------|-------|
| Row A: _(name)_ | _yes / no / working_ | _yes / no_ | _yes / no_ | |
| Row B: _(name)_ | _yes / no / working_ | _yes / no_ | _yes / no_ | |
| Row C: _(name)_ | _yes / no / working_ | _yes / no_ | _yes / no_ | |

**Ashley's overall SHAPE-05 verdict:**
_PASS (all clicked+idle rows show dot) / FAIL_NO_DOTS (no dots visible on any
clicked row) / FAIL_PARTIAL (some rows show dots, others don't) / FAIL_WRONG_ROWS
(dots on non-clicked rows)_

**If FAIL, Ashley's DevTools verification (paste into console):**
```js
document.querySelectorAll('[data-pv-conv-ready-dot="true"]').length
```
Expected: 3 (one per clicked+idle row). Actual: _(Ashley fill)_

```js
// Also useful for Candidate B verification:
// Find the row's data-conversation-id vs Terminal.tsx's published key.
[...document.querySelectorAll('[data-conversation-id]')].map(r => ({
  id: r.dataset.conversationId,
  selected: r.dataset.selected,
  activeSet: r.querySelector('.pv-row.active-set') !== null,
  hasReadyDot: r.querySelector('[data-pv-conv-ready-dot]') !== null,
}))
```

### 2C. Mobile iPhone PWA scroll test

**How to check (iPhone PWA):**

1. Land on the conversation list.
2. Scroll from top to bottom of the list. Momentum through — don't stop
   mid-scroll.
3. Scroll back up. Try a fast flick + a slow drag.
4. Try scrolling while a swipe is partially in progress (drag a row
   left ~10px, then try to scroll vertically without lifting finger).

**Ashley fills after live UAT:**

| Scroll gesture | Verdict | Notes (device model, iOS version if freeze) |
|----------------|---------|--------|
| Fast flick down | _smooth / freeze / hitch_ | |
| Slow drag down | _smooth / freeze / hitch_ | |
| Fast flick up | _smooth / freeze / hitch_ | |
| Slow drag up | _smooth / freeze / hitch_ | |
| Mid-swipe vertical scroll | _smooth / freeze / hitch_ | |

**Ashley's overall scroll verdict:**
_PASS (smooth all gestures) / FAIL_FREEZE (locks partway; specify which gesture) / FAIL_INTERMITTENT (freeze on some scrolls not others)_

### 2D. Safe-area padding on iPhone PWA (nice-to-have per SHAPE-04)

**How to check:**

1. On iPhone PWA, scroll the conversation list to the very bottom.
2. Verify the LAST row is NOT scrolled behind the home indicator
   (black bar at the bottom of the iPhone screen).

**Ashley fills after live UAT:**

- Last row visible ABOVE home indicator: _PASS / FAIL_
- Notes: _(Ashley fill; e.g., "last row's bottom edge is ~4px above home indicator, comfortable")_

### 2E. Pretty-view interior scope verification (SHAPE-06)

**How to check:**

1. Click into any pretty-view chat.
2. Confirm the interior is IDENTICAL to pre-Phase-13:
   - Bubbles (user cyan-tinted, assistant tan-tinted, tool-use plum)
   - ComposeBox (bottom-anchored, auto-grow textarea, send button)
   - IdentityBadge (top-of-scroll identity display)
   - Message rendering (markdown, code blocks, tool bubbles)
   - Chat-column background (no visual change)

**Ashley fills after live UAT:**

- Pretty-view interior unchanged from pre-Phase-13: _PASS / FAIL_
- If FAIL, specific element that changed: _(Ashley fill; ROUTES BACK as
  SHAPE-06 scope violation — hard fail)_

### 2F. RDP row + shadcn dialogs (SHAPE-06 preservation)

**How to check:**

1. Click into an RDP-host-sentinel row → Guacamole pane opens.
2. Confirm visual is unchanged from pre-Phase-13 (Termix theme classes
   preserved for RDP/shadcn per Ship-of-Theseus rule).
3. Optionally open any shadcn dialog (NewSessionDialog, TmuxSessionPicker,
   SSHAuthDialog, OPKSSHDialog) and confirm visual unchanged.

**Ashley fills after live UAT:**

- RDP pane visual unchanged: _PASS / FAIL_
- Shadcn dialogs visual unchanged: _PASS / FAIL_
- If FAIL, which surface changed: _(Ashley fill; ROUTES BACK as SHAPE-06
  scope violation — hard fail)_

### 2G. Freeform observations (Ashley's optional additional notes)

_Ashley: any observation not captured above — visual quirks, unexpected
delightful moments, "hmm that's weird" — write it here for the route-back
matrix to consider._

_(Ashley fill)_

---

## Section 3: Route-Back Matrix

**Exhaustive next-step enumeration for every possible UAT finding.** Each
row states: what Ashley observed, what the follow-up work is, whether the
fix belongs in this phase or the master bounty, and which candidate/
mechanism it maps to.

**Ownership legend:**
- `phase-13`: fix goes in a follow-up plan within Phase 13 (e.g. 13-05 or
  13-04-follow-up)
- `master`: fix goes in the master `skynet-transformation` bounty as a
  future patch, NOT this phase
- `closed`: no action needed — either passed or already-known-and-deferred

### 3A. SHAPE-05 dot visibility route-back

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS (all clicked+idle rows show dot) | Wave 1 restructured layout indirectly cleared the failure OR the failure never was in the source | Close SHAPE-05 as PASS. No follow-up needed. | closed |
| FAIL_NO_DOTS: `data-pv-conv-ready-dot` querySelectorAll returns 0 | JS-gate `inActiveSet && isWorking === false` never evaluates to true | Investigate which side is false. If activeSet is empty despite clicking rows → Candidate C failure (unlikely per static analysis but not impossible on iOS Safari PWA — check sessionStorage in Safari devtools). If isWorking never === false → Candidate A or B failure. | phase-13 (diagnostic session) |
| FAIL_NO_DOTS: `data-pv-conv-ready-dot` querySelectorAll returns 3 but Ashley sees 0 | CSS `display: none` is winning somehow (unlikely given inline `style="display: block"` at Row.tsx:418) OR the dot is rendered but visually hidden by a z-index / clip-path / opacity issue elsewhere | Ashley inspects the DOM element in devtools: `document.querySelector('[data-pv-conv-ready-dot]')` → check computed style for `display`, `visibility`, `opacity`, and any parent with `overflow: hidden` clipping it. | phase-13 (diagnostic session) |
| FAIL_PARTIAL: some rows show dots, others don't | **Candidate B (sessionWorkingKey mismatch) confirmed for the "fresh-terminal" path** — rows opened with `targetTmuxSession=null` won't match Terminal.tsx's published key at real backend sessionName | Add a follow-up plan to update Tab.targetTmuxSession from Terminal.tsx's `onTmuxSessionChange` callback (or plumb it through openTabs). Alternative: change publish key format to include a wildcard match. Root fix is in the Tab-lifecycle layer, not Terminal.tsx. | phase-13 (13-05 or 13-04-follow-up) — likely a 1-file fix in AppShell where openTabs is managed |
| FAIL_PARTIAL: only fleet-derived synthetic rows fail | **Candidate C ambiguity: fleet-only rows are never in activeSet on click (per intent) — they should be routed by `onDetachedRowClick` and NOT show dot until Ashley attaches** | Verify Ashley's expectation: dot on fleet-only rows is EXPLICITLY NOT part of SHAPE-05 (per Panel.tsx:53 detached-row plumbing). If Ashley thinks it should — that's a Rule 4 architectural request, needs discussion. If not — closed. | closed (SHAPE-05 is active-set only) |
| FAIL_WRONG_ROWS: dots on non-clicked rows | activeSet incorrectly populated OR a shared sessionStorage entry from a prior session leaked in | Ashley clears sessionStorage: `sessionStorage.removeItem('pv-conv-active-set')` in devtools console, then reloads. If dots reappear on non-clicked rows immediately → NEW bug in addToActiveSet call path (not previously suspected). If they don't reappear → stale sessionStorage cleared correctly. | phase-13 (13-05 or 13-04-follow-up) if reproducible after clear |
| FAIL: dot doesn't appear until Ashley switches away from the pane and back | **Candidate A confirmed: no client-side "assume idle at connect" fallback; backend's initial-state `{type:"idle"}` frame lag** | Options: (1) Add client-side default `setIsIdle(true)` in Terminal.tsx after WS-attach and before backend's first frame arrives — but this is a **Terminal.tsx edit, forbidden in this plan** per scope boundary. Route-back is: **fold into master bounty as a follow-up** or into a Phase 14 plan that owns Terminal.tsx. (2) Change Panel-side null-handling: treat null-store-state as "assume idle" for rows already in activeSet — riskier semantics change, needs Ashley's Rule 4 approval. | master (Terminal.tsx edit forbidden here) OR phase-13 (13-04-follow-up if Panel-side null-handling change is preferred) |
| PASS but with a delay: dot appears 1-2 seconds after clicking | Same as above (Candidate A) — backend's initial-state frame lag is real but tolerable | Close SHAPE-05 as PASS with a note in the master bounty about the initial-frame lag for future optimization. | closed (Ashley likely accepts this delay per verbatim "just so I know they've engaged") |

### 3B. Mobile scroll route-back

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS: all scroll gestures smooth | Wave 1 CSS restructuring inadvertently fixed OR the freeze was never source-side | Close mobile scroll as PASS. No follow-up needed. | closed |
| FAIL_FREEZE on instant-lock: fast flick doesn't scroll at all | **1B.1 (Angle tolerance too tight)** — PC_SWIPE_ANGLE_TOLERANCE too small; horizontal swipe detection captures ambiguous gestures | Add `.pv-row { touch-action: pan-y }` to pretty-conversations.css. Single-line change. Route-back: follow-up plan (13-05 or 13-04-follow-up) — pretty-conversations.css IS in this phase's scope. | phase-13 |
| FAIL_FREEZE on brief hitch: momentum stutters during scroll | **1B.2 (React re-render pause during onTouchMove)** OR **1B.3 (Safari backdrop-filter compositor stall)** | Investigate via iPhone Safari DevTools touch-event trace. Route-back is diagnostic first, then either RAF-throttle the setDxLive updates (JS-side) OR add `will-change: transform` to `.pv-row` (CSS hint to compositor). | phase-13 (13-05 diagnostic → potential follow-up fix plan) |
| FAIL_INTERMITTENT: freeze happens sometimes, not others | Race condition — possibly state-timing between multiple rows' setDxLive calls | iPhone Safari DevTools capture during freeze repro required. May become a dedicated bounty. | master (this is bigger than Phase 13 can absorb) |
| FAIL only when mid-swipe: vertical scroll while a row is partially swiped locks | onTouchMove line 175 bail-out isn't firing early enough OR gets confused when dxLive is already set | Same fix as 1B.1: add `.pv-row { touch-action: pan-y }` explicitly delegating vertical scroll to browser. | phase-13 |

### 3C. Safe-area padding route-back

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS: last row visible above home indicator | Workaround at PrettyConversationsPanel.tsx:233 is doing its job | Close as PASS with a note: the workaround is architecturally suboptimal (safe-area compensation belongs on the AppShell root, not on each scroller). Follow-up patch to master bounty for a future move. | closed for phase-13; master for future patch |
| FAIL: last row behind home indicator | Workaround INSUFFICIENT — `pb-[env(safe-area-inset-bottom)]` isn't being applied OR is being overridden by an ancestor `overflow: hidden` | Ashley checks in Safari devtools whether the padding is computed. If yes but visually failing — deeper layout issue (parent `min-h-0` may be collapsing the padding). If padding is 0 — Tailwind's arbitrary value class isn't compiling; fix is to move to inline style. | phase-13 (13-05 or 13-04-follow-up) |
| PASS but Ashley wants the architectural fix now | Not phase-blocking; nice-to-have | Add a follow-up plan to move safe-area compensation to AppShell.tsx:1400 outer wrapper and revert PrettyConversationsPanel.tsx:233's workaround. | master (SHAPE-04 explicitly limited to chevron; broader AppShell change is a Ship-of-Theseus master-bounty patch) |

### 3D. Overall parity (SHAPE-01/02/03/04) route-back

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS | All Waves 1-3 landed cleanly | Close SHAPE-01/02/03/04. | closed |
| DIFFERENCE_NOTED on row treatment | Wave 1 CSS drift from mock v4 | Re-lift specific selector from prototype.html mock v4. Diff PR back to Wave 1 output. | phase-13 (13-05 or 13-04-follow-up) |
| DIFFERENCE_NOTED on panel header | Wave 2 CSS drift | Same as above, targeting Wave 2. | phase-13 (13-05 or 13-04-follow-up) |
| DIFFERENCE_NOTED on PinAction | Wave 3 CSS drift | Same as above, targeting Wave 3. | phase-13 (13-05 or 13-04-follow-up) |
| DIFFERENCE_NOTED on chevron | Wave 2 SHAPE-04 CSS drift | Same as above, targeting Wave 2's AppShell chevron block. | phase-13 (13-05 or 13-04-follow-up) |

### 3E. Pretty-view interior (SHAPE-06) route-back — SCOPE VIOLATION MATRIX

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS | SHAPE-06 lockout held; no accidental Wave 1/2/3 spillover into pretty-view/ | Close SHAPE-06. | closed |
| FAIL | HARD FAIL — one of Waves 1/2/3 modified something in `src/ui/features/pretty-view/`. `git diff HEAD~N -- src/ui/features/pretty-view/` will identify the offending commit. | Revert the pretty-view changes from the responsible Wave's commit. Rebase Wave forward without the scope violation. | phase-13 (immediate revert + rebase); mandatory before phase closes |

### 3F. RDP + shadcn (SHAPE-06) route-back — SCOPE VIOLATION MATRIX

| Ashley's finding | Root cause hypothesis | Route-back action | Owner |
|-----|-----|-----|-----|
| PASS | Ship-of-Theseus scope preserved. | Close. | closed |
| FAIL: shadcn dialog broken | Wave 1/2/3 modified `src/ui/components/`, `src/ui/ssh/`, or `src/ui/features/terminal/` | HARD FAIL — revert + rebase. Verify Ship-of-Theseus rule is honored for upstream rebase-ability. | phase-13 (immediate revert + rebase); mandatory before phase closes |
| FAIL: RDP pane visual regressed | Same as above (probably a shared class-inheritance leak from `--color-pv-*` tokens into a Termix theme surface) | Investigate CSS token bleeding. Termix theme classes (`--foreground`, `--background`, etc.) should be independent from `--color-pv-*`. If any pv token is being applied to an RDP surface, that's the leak. | phase-13 (diagnostic + revert appropriate scope) |

---

## Section 4: Deferred Route-Backs Awaiting Ashley's UAT

**Executor state after this pre-UAT pass:**

- All 4 dot-visibility candidates have static-analysis verdicts (2 SUSPECT/MISMATCH, 2 PASS)
- Mobile scroll and safe-area padding have static-analysis verdicts
- No source edits made in this plan (verified: `git diff --stat src/` empty)
- Ashley's UAT sections (2A-2G) are TEMPLATES ready for her live observation
- Route-back matrix (3A-3F) is EXHAUSTIVE per plan requirement

**Executor's provisional recommendation to Ashley (based purely on static
analysis):**

The MOST LIKELY dot-visibility failure mode is **Candidate B.1** —
the "fresh-terminal path" where a Tab is opened with `targetTmuxSession=null`
and Terminal.tsx publishes at a different key than the row is reading. This
is a real, static-analysis-confirmed key mismatch in a specific code path.
If Ashley's UAT shows this exact partial-failure pattern (rows work for
some sessions but not others), the fix is straightforward.

The SECOND-MOST LIKELY failure mode is **Candidate A.1** — the initial-
frame lag. This one is timing-dependent and cannot be reliably reproduced
in static analysis. Ashley's UAT observation of "dot appears with a delay"
vs "dot never appears" will disambiguate.

**Candidates C and D are PASS by static analysis and should not be
suspected first.** If Ashley's UAT shows total FAIL_NO_DOTS but the
Rules-of-Hooks and activeSet paths are provably clean, the failure mode
would have to be elsewhere entirely (Section 3A row for that case
enumerates deeper investigation paths).

**Ashley: proceed to live UAT of Waves 1-3 + shell chrome. Fill in
Sections 2A-2G with observations, then this plan closes as PARTIAL (with
route-back citation) or PASS depending on outcome.**

---

## Section 5: Self-Check

- **Section 1 (Automated diagnostic findings) exists:** yes
- **4 candidates have verdicts:** yes (A: SUSPECT, B: MISMATCH, C: PASS, D: PASS)
- **Mobile scroll has verdict:** yes (UNCHANGED FROM PRE-WAVE-1)
- **Safe-area has verdict:** yes (WORKAROUND STILL NEEDED)
- **Section 2 (Ashley UAT template) exists with placeholder verdicts:** yes
- **Section 3 (Route-back matrix) covers all UAT outcomes:** yes (SHAPE-05,
  scroll, safe-area, parity, SHAPE-06 x2)
- **No source changes:** `git diff --stat src/` → verified empty
- **Executor did NOT invent Ashley's observations:** confirmed; all Section 2
  verdict cells are template placeholders
- **Scope boundaries respected:** Terminal.tsx READ-ONLY (verified — no edit);
  no writes under `src/ui/features/pretty-view/`, `src/ui/components/`,
  `src/ui/ssh/`, or `src/ui/features/terminal/`; and no CSS/tsx source
  edits under `src/ui/features/pretty-conversations/` (Waves 1-3 own those)

**Status: pre-UAT complete; blocked on Ashley live UAT of deployed Waves 1-3 + shell chrome.**
