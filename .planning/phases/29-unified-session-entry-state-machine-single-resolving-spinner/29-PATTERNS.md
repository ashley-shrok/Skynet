# Phase 29: Unified session-entry state machine — single resolving spinner - Pattern Map

**Mapped:** 2026-08-10
**Files analyzed:** 7 (2 new, 5 modified, 2 possibly new tests)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| **NEW**: `src/ui/features/pretty-view/resolve-phase.ts` (or `src/ui/state/…`) | pure reducer | pure function (test-seam split) | `src/backend/claude-session/layer1-detect.ts` (`applyLineToLayer1State`, `isUserTurn`) | **exact** |
| **NEW**: `src/ui/features/pretty-view/usePaneResolvingMachine.ts` (or `src/ui/state/…`) | hook (state machine) | event-driven (WS + prop edges) | `src/ui/features/pretty-view/use-pretty-view-uploads.ts` for hook posture; PrettyView.tsx WS-setup effect + refs mirror pattern (L1240-1291) for internal shape | **role-match** (no hook fully mirrors this exact reducer-in-hook shape) |
| **NEW**: `src/ui/features/pretty-view/resolve-phase.test.ts` | test | pure truth-table | `src/backend/claude-session/layer1-detect.test.ts` | **exact** |
| **NEW**: `src/ui/features/pretty-view/usePaneResolvingMachine.test.ts` | test | hook behavior + edges | `src/ui/state/session-recycling-store.test.ts` (`renderHook` + `act`) + PrettyView.test.tsx (mock WS + fake timers) | **role-match** |
| **NEW**: `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` (or extended `SessionHoldingOverlay` error variant) | component | render | `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` error-variant branch (L64-73, L153-176) + `DormancyOverlay.tsx` Wake button (L175-187) | **exact** (compose two existing patterns) |
| **NEW**: `src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx` | test | component | `DormancyOverlay.test.tsx` + `SessionHoldingOverlay.test.tsx` | **exact** |
| **MODIFY**: `src/ui/features/pretty-view/PrettyView.tsx` | component (host) | orchestration | itself — subsume existing `useState`+`useEffect` blocks; new hook is a factoring, not a new pattern | **self** |
| **MODIFY (or DELETE)**: `src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx` | component | render | itself (visual preserved per D-01); mount-gate changes to `phase === "resolving"` | **self** |
| **MODIFY**: `src/ui/features/pretty-view/PrettyView.test.tsx` | test | integration | itself + new structural-grep tests copying `Terminal.wiring.test.ts:544-627` planted-tag pattern | **role-match** |
| **MODIFY (possibly no-op)**: `src/ui/state/session-recycling-store.ts` | store (module-scoped) | pub-sub | itself — publish contract preserved per SPEC req 7; only PrettyView caller changes | **self** |

## Pattern Assignments

### 1. `resolve-phase.ts` (NEW — pure reducer, test-seam split)

**Analog:** `src/backend/claude-session/layer1-detect.ts`

This is the **canonical fork pattern** for extracting a pure state-derivation reducer out of a stateful host so it's unit-testable in isolation. Copy this shape exactly for `resolvePhase()`.

**Module-header rationale block pattern** (`layer1-detect.ts:1-48`):
```typescript
/**
 * Layer 1 fast-path recycle detector — pure helpers extracted from
 * claude-session-server.ts (quick 260808-ohn / bounty
 * session-holding-layer1-detect-id-reset-not-exit).
 *
 * WHY THIS EXISTS (Ashley's design point 2):
 *   [multi-paragraph rationale explaining the bug this fixes + why the
 *    tail-state-derived model replaces the previous heuristic]
 *
 * All helpers here are PURE (no I/O, no imports from ssh2 / WebSocket /
 * logger / anything I/O-shaped). This is what makes them cheap to
 * unit-test at layer1-detect.test.ts granularity; the integration seam
 * __applyLayer1LineForTests below composes them into the exact shape
 * the production onLine handler uses, so the two cannot drift.
 */
```

**Type-union alias pattern** (`layer1-detect.ts:120-129, 139`):
```typescript
export type Layer1State = {
  mostRecentUserTurnIsIdReset: boolean | null;
};

export type Layer1Action = "none" | "arm_holding" | "clear_holding";

type ChangeoverState = "active" | "holding" | "dead";
```

Copy this exactly for:
```typescript
export type WsState = "not-connected" | "opening" | "open" | "failed-permanently";
export type BackendFirstFrame = "not-yet" | "active" | "inactive" | "session_holding" | "dormant";
export type Phase = "resolving" | "active" | "holding" | "dormant" | "inactive" | "error";
```

**Pure reducer signature** (`layer1-detect.ts:164-185`):
```typescript
export function applyLineToLayer1State(
  line: string,
  state: Layer1State,
  currentChangeoverState: ChangeoverState,
): Layer1Action {
  if (currentChangeoverState === "dead") return "none";
  if (!isUserTurn(line)) return "none";
  const isReset = isIdResetUserTurn(line);
  state.mostRecentUserTurnIsIdReset = isReset;
  if (isReset && currentChangeoverState === "active") return "arm_holding";
  if (!isReset && currentChangeoverState === "holding") return "clear_holding";
  return "none";
}
```

Copy this shape for the truth-table resolver:
```typescript
export function resolvePhase(wsState: WsState, backendFirstFrame: BackendFirstFrame): Phase {
  if (wsState === "failed-permanently") return "error";
  if (wsState === "not-connected" || wsState === "opening") return "resolving";
  // wsState === "open"
  if (backendFirstFrame === "not-yet") return "resolving";
  if (backendFirstFrame === "active") return "active";
  if (backendFirstFrame === "session_holding") return "holding";
  if (backendFirstFrame === "dormant") return "dormant";
  if (backendFirstFrame === "inactive") return "inactive";
  // Exhaustiveness — no default needed if TS `noImplicitReturns` is on.
  const _exhaust: never = backendFirstFrame;
  return _exhaust;
}
```

**"NO I/O IMPORTS" constraint from `layer1-detect.ts:44-48`**:
> All helpers here are PURE (no I/O, no imports from ssh2 / WebSocket / logger / anything I/O-shaped). This is what makes them cheap to unit-test.

Applied to `resolve-phase.ts`: **no React imports, no WS imports, no logger imports** — just the type aliases and the pure function. Enables `import { resolvePhase } from "./resolve-phase"` with zero setup cost from unit tests.

---

### 2. `usePaneResolvingMachine.ts` (NEW — hook consuming the reducer)

**Analog (composite):** No single analog covers all four responsibilities. Compose three patterns:

**(a) Ref-mirror for stale-closure protection** — `PrettyView.tsx:1240-1291`:
```typescript
// Patch #148: statusRef mirror — keeps statusRef.current in sync with the
// `status` state so WS callbacks (onclose, visibilitychange handler) can
// read the current status WITHOUT triggering functional-update double-renders.
useEffect(() => {
  statusRef.current = status;
}, [status]);

// Quick 260808-b74: isVisibleRef mirror — keeps isVisibleRef.current in sync
// with the `isVisible` prop so onclose retry scheduler and visibilitychange
// handler can read current pane visibility without React closure-capture issues.
useEffect(() => {
  isVisibleRef.current = isVisible;
}, [isVisible]);

// quick 260808-cd6: dormantRef mirror — keeps dormantRef.current in sync
// with the `dormant` state so the WS onmessage auto-dismiss hook can read
// current dormant state without stale-closure issues.
useEffect(() => {
  dormantRef.current = dormant;
}, [dormant]);
```

Apply to the new hook's `wsStateRef` + `backendFirstFrameRef` + `hasEverResolvedRef` — any state that WS callbacks or effect cleanups read must be mirrored to a ref via a `[state]`-dep effect.

**(b) Ref-declaration + companion mirror** — `PrettyView.tsx:344-348, 559-573`:
```typescript
const isBootingRef = useRef<boolean>(false);
// ...
const [retryKey, setRetryKey] = useState<number>(0);
const statusRef = useRef<Status>('connecting');
const isVisibleRef = useRef<boolean>(isVisible);
const dormantRef = useRef<boolean>(false);
```

Initial values match the state's initial value verbatim so first-render reads are consistent.

**(c) Delay-arm useEffect for spinner-mount (D-04)** — `PrettyView.tsx:1416-1436`:
```typescript
// Patch #74: delay-armed gate for the SessionHoldingOverlay. When
// `isHolding` becomes true, arm a ~350ms timer; only after it fires
// does `showOverlay` flip true (and the overlay mounts). When
// `isHolding` becomes false, clear the pending timer AND drop
// `showOverlay` immediately — so genuinely-instant resets NEVER flash.
useEffect(() => {
  if (!isHolding) {
    setShowOverlay(false);
    return;
  }
  const t = setTimeout(() => {
    setShowOverlay(true);
  }, 350);
  return () => {
    clearTimeout(t);
  };
}, [isHolding]);
```

Copy this exact shape for the new hook's 150ms spinner-arm effect. Key invariants:
- Cleanup ALWAYS clears the timer (unmount + isHolding-flips-false both trip the return).
- Instant clear on the "off" edge (`setShowOverlay(false)` synchronously when isHolding=false).
- **NO wall-clock deadline anywhere else** (SPEC req 5) — only the ~150ms paint-delay armed timer.

**(d) Fresh-pane cold-mount vs retryKey warm-run distinction** — `PrettyView.tsx:725-767`:
```typescript
useEffect(() => {
  // Patch #148: distinguish a fresh pane mount from a retryKey-triggered re-run.
  // On a fresh pane (hostId/tmuxSession changed), reset ALL state and the attempt
  // counter. On a retry re-run (same pane, retryKey bumped), preserve messages/
  // status so the UI does not flash blank while reconnecting.
  if (paneKey !== paneKeyRef.current) {
    // Fresh pane mount — full reset.
    setMessages([]);
    setStatus("connecting");
    // ...
    setIsBooting(true);
    // ...
    reconnectAttemptsRef.current = 0;
    paneKeyRef.current = paneKey;
  }
  // retryKey-triggered re-runs skip the reset above — preserving messages/status
  // so the UI stays visible while the fresh WS is being opened.
  // ...
}, [hostId, tmuxSession, retryKey]);
```

The new hook's cold-mount entry-trigger uses this same `paneKey !== paneKeyRef.current` sentinel. Warm re-focus enters through `isVisible` false→true edge (see item e); PWA foreground through the visibilitychange effect (`PrettyView.tsx:1210-1238`).

**(e) `isVisible` false→true edge detector** — `PrettyView.tsx:1262-1284` (prevIsVisibleRef pattern from quick-260809-cnx):
```typescript
const prevIsVisibleRef = useRef<boolean>(isVisible);

useEffect(() => {
  const prev = prevIsVisibleRef.current;
  prevIsVisibleRef.current = isVisible;
  if (!prev && isVisible) {
    // ... false→true edge fired
  }
}, [isVisible]);
```

Initial `useRef<boolean>(isVisible)` (not `false`) is **load-bearing** — otherwise initial mount trips the edge false-positive. Comment at L1263-1265 documents this.

**Hook signature target** (from SPEC req 3):
```typescript
export function usePaneResolvingMachine(deps: {
  hostId: number | null;
  tmuxSession: string | null;
  isVisible: boolean;
  // …WS + backend event subscription plumbing…
}): {
  wsState: WsState;
  backendFirstFrame: BackendFirstFrame;
  phase: Phase;
  // …plus retry callback for the error-phase button per D-09
} {
  // ...
}
```

Grep-gate on the type file per SPEC req 3 acceptance criteria: only `wsState` and `backendFirstFrame` appear as resolution inputs in the exported type.

---

### 3. `resolve-phase.test.ts` (NEW — truth-table)

**Analog:** `src/backend/claude-session/layer1-detect.test.ts`

**Test-file header pattern** (`layer1-detect.test.ts:1-17`):
```typescript
/**
 * Unit tests for the Layer 1 fast-path recycle detector helpers extracted
 * from claude-session-server.ts (quick 260808-ohn / bounty
 * session-holding-layer1-detect-id-reset-not-exit).
 *
 * [multi-paragraph rationale explaining WHY the tests exist and what the
 *  helpers are + isn't]
 */

import { describe, it, expect } from "vitest";
import {
  isUserTurn,
  isIdResetUserTurn,
  applyLineToLayer1State,
  type Layer1State,
} from "./layer1-detect.js";
```

Copy for `resolve-phase.test.ts` — import `resolvePhase` + `WsState`/`BackendFirstFrame`/`Phase` types.

**Grouped-describe truth-table pattern** (`layer1-detect.test.ts:125-411`):
```typescript
describe("isUserTurn", () => {
  it('returns true for a "type":"user" line', () => { ... });
  it('returns false for a "type":"assistant" line', () => { ... });
  // ...
});

describe("applyLineToLayer1State — non-user turns never change state", () => {
  it("initial state + non-user line + active → returns none, state unchanged", () => { ... });
  // ...
});

describe("applyLineToLayer1State — arm_holding", () => {
  it("initial state + /id reset user turn + active → arm_holding, state.isIdReset=true", () => { ... });
});
```

Copy exactly — one `describe` per input class, one `it` per truth-table row. SPEC req 4 acceptance: **every** (wsState × backendFirstFrame) combination gets its own `it`, asserting the exact resulting `phase`.

Suggested `describe` groupings for `resolvePhase`:
- `describe("resolvePhase — wsState=not-connected always resolving")` — 5 `it`s (one per backendFirstFrame)
- `describe("resolvePhase — wsState=opening always resolving")` — 5 `it`s
- `describe("resolvePhase — wsState=open (main terminal-phase branch)")` — 5 `it`s (not-yet→resolving, active→active, session_holding→holding, dormant→dormant, inactive→inactive)
- `describe("resolvePhase — wsState=failed-permanently always error")` — 5 `it`s

Total: 20 `it`s covering the full 4×5 cross product.

---

### 4. `usePaneResolvingMachine.test.ts` (NEW — hook behavior)

**Analog (composite):**

**(a) `renderHook` + `act` for hook testing** — `src/ui/state/session-recycling-store.test.ts:41-68`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
// ...

describe("session-recycling-store: publish → hook round-trip", () => {
  it("publish(true) → hook returns true; ...", () => {
    const { result, rerender } = renderHook(() =>
      useSessionRecycling("h1:s1"),
    );
    expect(result.current).toBeNull();

    act(() => {
      publishSessionRecycling("h1:s1", true);
    });
    rerender();
    expect(result.current).toBe(true);
  });
});
```

Use this for `usePaneResolvingMachine` state assertions — drive WS/backend event inputs into the hook and assert `result.current.phase` transitions.

**(b) Fake-timers + WS-mock harness** — `PrettyView.test.tsx:290-322`:
```typescript
describe("PrettyView — patch #148 WebSocket auto-reconnect", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // ...
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test A (must): retry-on-close — fires fresh WS after backoff and clears errorMessage on onopen", () => {
    // ...
  });
});
```

Copy for hook-level tests of the ~150ms delay-arm (D-04) and the three entry-trigger edges (cold mount, warm re-focus, PWA foreground). Fake timers let you assert "spinner mounts at 150ms" and "spinner does NOT mount if inputs settle at 100ms".

---

### 5. `PrettyViewErrorOverlay.tsx` (NEW component — D-07 warm-red error card + D-09 retry button)

**Analog:** Compose two existing components' patterns.

**(a) Warm-red error card structure** — `SessionHoldingOverlay.tsx:88-187` (error variant branch):
```typescript
export function SessionHoldingOverlay({
  error = false,
}: SessionHoldingOverlayProps) {
  return (
    <div
      role="status"
      aria-label={
        error
          ? "Session recycle failed — refresh the browser to check"
          : "Session recycling — pretty view temporarily unavailable"
      }
      className={cn(
        "absolute inset-0 z-[99]",
        "flex items-center justify-center",
        "backdrop-blur-md bg-black/40",
        "[-webkit-backdrop-filter:blur(12px)]",
        // iOS Safari backdrop-filter compositor-churn hardening.
        "isolate [transform:translateZ(0)]",
        "pointer-events-auto",
        "animate-in fade-in duration-150",
      )}
    >
      <div
        className={cn(
          "rounded-[var(--radius-pv-bubble)] px-4 py-3",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // Patch #127: error variant flips card body to warm-red-tinted gradient.
          error
            ? "bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]"
            : "bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))]",
          error ? "text-[#f5d0d4]" : "text-[#dfe3ee]",
          "border border-white/[0.08]",
          error
            ? "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]"
            : "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          "flex items-center gap-3 text-sm",
        )}
      >
        <RefreshCcw
          className={cn(
            "h-4 w-4 shrink-0",
            error && "text-[hsl(0,72%,60%)]",
          )}
          aria-hidden="true"
        />
        <span>
          {error
            ? "Session recycle failed — refresh to check"
            : "Session recycling…"}
        </span>
      </div>
    </div>
  );
}
```

For `PrettyViewErrorOverlay`, take **only** the `error=true` classes (drop the ternaries). Copy verbatim:
- Scrim: `"absolute inset-0 z-[99]"`, `"backdrop-blur-md bg-black/40"`, `"isolate [transform:translateZ(0)]"`, `"pointer-events-auto"`, `"animate-in fade-in duration-150"` — non-negotiable (patch #333 iOS hardening; motion-channel guardrail).
- Card: warm-red gradient `"bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]"`, text `"text-[#f5d0d4]"`, warm-red inset shadow.
- Glyph: **STATIC** `RefreshCcw` with `"text-[hsl(0,72%,60%)]"` — do NOT add `animate-spin` (D-07 says "static, state not work"; motion-channel guardrail applies).

**(b) Retry button (D-09) — Wake button UX shape** — `DormancyOverlay.tsx:175-187, 43`:
```typescript
import { Button } from "@/components/button";
// ...
{!waking && (
  <Button
    size="sm"
    variant="secondary"
    className="cursor-pointer"
    onClick={onWake}
    aria-label="Wake identity"
  >
    Wake
  </Button>
)}
```

Copy the shape:
```typescript
<Button
  size="sm"
  variant="secondary"
  className="cursor-pointer"
  onClick={onRetry}
  aria-label="Retry connection"
>
  Retry
</Button>
```

**Flex direction:** Since the card now has TWO children (glyph+copy row AND button), use `DormancyOverlay`'s `"flex flex-col items-center gap-3 text-sm"` (L127) NOT `SessionHoldingOverlay`'s single-row `"flex items-center gap-3 text-sm"` (L165). Then wrap the glyph+copy in an inner `<div className="flex items-center gap-3">` (mirrors `DormancyOverlay.tsx:131`).

**Props signature (mirror DormancyOverlayProps)** — `DormancyOverlay.tsx:53-64`:
```typescript
interface PrettyViewErrorOverlayProps {
  onRetry: () => void;
}
```

Copy for planner's decision on D-08 copy: "Connection failed — retry" is the SPEC-provided default; final locked via UAT.

---

### 6. `PrettyViewErrorOverlay.test.tsx` (NEW test)

**Analog:** `DormancyOverlay.test.tsx` (composite of asleep+wake button variant) + `SessionHoldingOverlay.test.tsx` (error variant + static-glyph guardrail).

**Test structure pattern** — `DormancyOverlay.test.tsx:1-46`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DormancyOverlay } from "./DormancyOverlay";

describe('DormancyOverlay — asleep state (waking=false, no error)', () => {
  it('renders "This session is asleep" text and an enabled Wake button', () => {
    render(
      <DormancyOverlay waking={false} elapsedSeconds={0} onWake={vi.fn()} error={null} />,
    );
    expect(screen.getByText(/session is asleep/i)).toBeTruthy();
    const wakeBtn = screen.getByRole('button', { name: /wake identity/i }) as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();
    expect(wakeBtn.disabled).toBe(false);
  });
});

describe('DormancyOverlay — Wake button click', () => {
  it('Wake button click invokes the onWake prop exactly once', () => {
    const onWake = vi.fn();
    render(<DormancyOverlay waking={false} elapsedSeconds={0} onWake={onWake} />);
    const wakeBtn = screen.getByRole('button', { name: /wake identity/i });
    fireEvent.click(wakeBtn);
    expect(onWake).toHaveBeenCalledTimes(1);
  });
});
```

**Motion-channel static-glyph guardrail regression test** — `DormancyOverlay.test.tsx:12-13` header + equivalent in `SessionHoldingOverlay.test.tsx`:
```typescript
describe("PrettyViewErrorOverlay — motion-channel guardrail (static RefreshCcw)", () => {
  it("RefreshCcw svg does NOT carry animate-spin (state, not work — D-07)", () => {
    const { container } = render(<PrettyViewErrorOverlay onRetry={vi.fn()} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").not.toMatch(/(^| )animate-spin( |$)/);
  });
});
```

Mirror the inverse of `PrettyViewLoadingOverlay.test.tsx:83-98` (which asserts `animate-spin` IS present because loading is work). For the error overlay it MUST be absent.

---

### 7. `PrettyView.tsx` (MODIFY — replace 6 local hooks with `phase` + rewire mount gates)

**Current mount gate JSX to REPLACE** — `PrettyView.tsx:1773, 1778-1785, 1795, 1796-1810`:
```typescript
{showOverlay && <SessionHoldingOverlay error={holdingTimeoutError} />}
{dormant && (
  <DormancyOverlay
    waking={waking}
    elapsedSeconds={elapsedSeconds}
    onWake={handleWake}
    error={wakeError}
  />
)}
{isBooting && !dormant && !showOverlay && <PrettyViewLoadingOverlay />}
{status === "connecting" && (
  <div className="...">Connecting…</div>
)}
{status === "inactive" && !dormant && (
  <div className="...">no active Claude session</div>
)}
{status === "error" && errorMessage && (
  <div className="...">{errorMessage}</div>
)}
```

**Post-refactor mount gate JSX (target shape per SPEC req 2 + 6)**:
```typescript
{phase === "resolving" && <PrettyViewLoadingOverlay />}
{phase === "holding" && <SessionHoldingOverlay error={/* only if applicable; holdingTimeoutError retired */} />}
{phase === "dormant" && (
  <DormancyOverlay
    waking={waking}
    elapsedSeconds={elapsedSeconds}
    onWake={handleWake}
    error={wakeError}
  />
)}
{phase === "inactive" && (
  <div className="flex-1 flex items-center justify-center p-4 text-sm text-[var(--color-pv-fg-muted)]">
    no active Claude session
  </div>
)}
{phase === "error" && <PrettyViewErrorOverlay onRetry={handleRetry} />}
```

**DELETE** the transient `status === "connecting"` "Connecting…" and `status === "error" && errorMessage` "Connection lost" text nodes (SPEC boundary + acceptance grep).

**Effects to DELETE**:
- `PrettyView.tsx:1453-1461` — the 600000ms `setHoldingTimeoutError(true)` watchdog (SPEC req 5 acceptance).
- `PrettyView.tsx:1486-1493` — the 10s `PrettyViewLoadingOverlay` auto-dismiss (SPEC req 5 acceptance).
- `PrettyView.tsx:1470-1472` — `holdingTimeoutError` reset effect (paired with the deleted watchdog; retire together with the `holdingTimeoutError` state itself).

**State hooks to SUBSUME / DELETE** (planner-picks migration order per Claude's Discretion):
- `PrettyView.tsx:307` `[isHolding, setIsHolding]` — derive from `phase === "holding"` or keep as internal input to the machine.
- `PrettyView.tsx:319` `[showOverlay, setShowOverlay]` — retire entirely; `phase === "holding"` replaces it.
- `PrettyView.tsx:326` `[holdingTimeoutError, setHoldingTimeoutError]` — retire entirely (D-10 + SPEC req 5: no wall-clock heuristic).
- `PrettyView.tsx:330-334` dormant/waking/etc. — the DormancyOverlay props (`waking`, `elapsedSeconds`, `onWake`, `wakeError`) still need SOME state, but the mount-gate switches from `dormant` to `phase === "dormant"`. Planner audits: does the machine own dormant, or does dormant stay local with mount-gate flipped to `phase === "dormant"`?
- `PrettyView.tsx:343` `[isBooting, setIsBooting]` — retire; `phase === "resolving"` replaces it.
- `PrettyView.tsx:348` `isBootingRef` — retire with `isBooting`.

**ComposeBox prop derivation** (from CONTEXT integration point, `PrettyView.tsx:2030, 2038, 2058, 2062`):
```typescript
// Current:
isHolding={isHolding}
recycleActive={showOverlay}
reconnectingActive={status === "error"}
dormantActive={dormant || waking}

// Post-refactor:
isHolding={phase === "holding"}
recycleActive={phase === "holding"}
reconnectingActive={phase === "error"}
dormantActive={phase === "dormant" /* keep || waking if waking survives as internal */}
```

Wiring layer only; ComposeBox itself doesn't change (SPEC boundary).

---

### 8. `PrettyViewLoadingOverlay.tsx` (MODIFY-in-place OR RETIRE per D-01)

**Analog:** itself. Per D-01, visual is preserved verbatim — Loader2 + "Loading…" copy + iOS hardening. Planner picks:
- **Option A (keep file)**: mount gate in PrettyView flips from `isBooting && !dormant && !showOverlay` to `phase === "resolving"`. File body unchanged.
- **Option B (retire file)**: inline the JSX inside the hook's return or PrettyView's overlay render block; delete this file + its test.

Existing tests (`PrettyViewLoadingOverlay.test.tsx` 5 tests, especially Test 5 motion-channel deviation guard L83-98) MUST continue to pass — either they test the same component (Option A) or the equivalent inline JSX (Option B).

---

### 9. `PrettyView.test.tsx` (MODIFY — mount-gate assertions + new structural-grep gates)

**Structural-grep test pattern** — `src/ui/features/terminal/Terminal.wiring.test.ts:544-627`:
```typescript
describe("quick-260809-eqk — hidden-pane WS-pause + diag fix", () => {
  const src = readFileSync(TERMINAL_TSX, "utf-8");
  const PV_SRC_PATH = join(HERE, "..", "pretty-view", "PrettyView.tsx");
  const pvSrc = readFileSync(PV_SRC_PATH, "utf-8");

  it("Test eqk-2: Terminal.tsx contains a new [isVisible]-keyed useEffect tagged quick-260809-eqk with close() + attemptReconnection()", () => {
    // Anchor on the planted comment tag introducing the WS-pause effect.
    const anchor = "quick-260809-eqk — Terminal-SSH WS-pause lifecycle effect";
    const anchorIdx = src.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThan(0);
    const block = src.slice(anchorIdx, anchorIdx + 8000);
    expect(block).toMatch(/useEffect\(\(\) => \{/);
    expect(block).toContain("webSocketRef.current");
    expect(block).toContain("ws.close()");
    expect(block).toContain("attemptReconnection()");
    expect(block).toMatch(/\}, \[isVisible\]\);/);
  });
});
```

For Phase 29, the planted-tag scheme should read something like:
```typescript
// phase-29: unified pane-entry state machine — resolving overlay mount gate
```

Then the structural-grep test asserts:
1. **Only `PrettyViewLoadingOverlay` mounts in `phase === "resolving"`** — grep in PrettyView.tsx source finds the mount site tagged `phase-29`, then asserts the block contains `phase === "resolving"` AND does NOT contain `SessionHoldingOverlay`/`DormancyOverlay`/`Connecting…`/`Connection lost` within that JSX block window.
2. **Each terminal-state overlay is gated on its specific `phase` value** — grep for `<SessionHoldingOverlay`, `<DormancyOverlay`, and the inactive-fallback/error nodes, then assert the immediately preceding conditional contains the correct `phase === "<value>"`.
3. **`setTimeout` grep-gate on the new hook file** (SPEC req 5 acceptance): `expect(hookSrc.match(/setTimeout/g) ?? []).toHaveLength(1)` — only the 150ms delay-arm is permitted. Zero if delay-arm is implemented via `requestAnimationFrame` or is inside a `useEffect` that plans instead.
4. **"Connection lost" / "Connecting…" grep — MUST NOT APPEAR** in PrettyView.tsx source (SPEC acceptance criterion): `expect(pvSrc).not.toMatch(/Connection lost/); expect(pvSrc).not.toMatch(/Connecting…/);`.

**Existing WS-mock harness to reuse** — `PrettyView.test.tsx:15-56, 39-56`:
```typescript
vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    return {
      // ... mock WS shape
      send: vi.fn(),
      close: vi.fn(),
      // ...
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }),
  // ...
}));
```

New flicker-regression tests (SPEC acceptance criterion — 3 named cases) drive the mock WS: fire `openClaudeSessionSocket` + inject the historical bad-frame sequence + assert `screen.getByRole("status", { name: /Loading/i })` is the ONLY overlay mounted during the window.

---

### 10. `session-recycling-store.ts` (MODIFY — likely NO-OP; contract preserved)

**Analog:** itself. SPEC req 7 explicitly preserves the `publishSessionRecycling(key, isRecycling)` contract. Only the CALLER's derivation source changes.

**Current publisher call in PrettyView.tsx:1514-1517**:
```typescript
useEffect(() => {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  publishSessionRecycling(key, showOverlay);
}, [showOverlay, hostId, tmuxSession]);
```

**Post-refactor**:
```typescript
useEffect(() => {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  publishSessionRecycling(key, phase === "holding");
}, [phase, hostId, tmuxSession]);
```

**Existing test — `session-recycling-store.test.ts`** — 5 tests, all continue to pass unchanged (they exercise the store's public surface, not the caller).

**New test locking `resolving → holding` transition** (SPEC req 7 acceptance):
```typescript
describe("session-recycling-store: phase-29 resolving → holding publishes true", () => {
  it("entering phase='holding' publishes true; resolving publishes false; leaving holding publishes false", () => {
    // renderHook rendering PrettyView-slice OR the new hook with controllable
    // WS+backendFirstFrame inputs; drive through the transition; assert
    // getSessionRecyclingSnapshot() at each step.
  });
});
```

---

## Shared Patterns

### Motion-Channel Guardrail (patch #72 lineage)
**Source:** `SessionHoldingOverlay.tsx:38-46` (file-header comment), `PrettyViewLoadingOverlay.tsx:17-35` (deviation rationale).
**Apply to:** `PrettyViewErrorOverlay` (STATIC RefreshCcw); `PrettyViewLoadingOverlay` (ANIMATED Loader2, unchanged).
```typescript
// From SessionHoldingOverlay:
// GUARDRAIL — motion channel:
//   The glyph is a STATIC `RefreshCcw`. Do NOT add `animate-spin` here.
//   Patch #72 established the rule that the motion channel across pretty
//   view is owned by `WipBubble` — a spinner in this overlay would steal
//   focus from real work-in-progress indicators. Static glyph = STATE, not
//   WORK.
```
Regression-guard test per component (present in both existing overlay tests): `expect(svg?.getAttribute("class")).not.toMatch(/animate-spin/)` for state overlays; `.toMatch(/animate-spin/)` for the resolving spinner.

### iOS Safari Backdrop-Filter Hardening (patch #333 lesson)
**Source:** `PrettyViewLoadingOverlay.tsx:72-78`, `SessionHoldingOverlay.tsx:121-133`, `DormancyOverlay.tsx:96-102` (verbatim across all three).
**Apply to:** every new backdrop-filter surface (i.e., `PrettyViewErrorOverlay`).
```typescript
// Verbatim class-list tokens (non-negotiable):
"backdrop-blur-md bg-black/40",
"[-webkit-backdrop-filter:blur(12px)]",
"isolate [transform:translateZ(0)]",
```
Test coverage pattern from `PrettyViewLoadingOverlay.test.tsx:59-79`:
```typescript
expect(cls).toMatch(/(^| )isolate( |$)/);
expect(cls).toMatch(/(^| )\[transform:translateZ\(0\)\]( |$)/);
```

### Ref-Mirror for Stale-Closure Protection
**Source:** `PrettyView.tsx:1240-1291` (four separate mirror effects: statusRef, isVisibleRef, dormantRef, isBootingRef).
**Apply to:** any state inside the new hook that's read from WS `onmessage` / `onclose` / `visibilitychange` callbacks. Specifically `wsStateRef`, `backendFirstFrameRef`, `hasEverResolvedRef` (D-12) are candidates.
```typescript
useEffect(() => {
  wsStateRef.current = wsState;
}, [wsState]);
```
Pattern: `useRef<T>(initialFromSameSource)` + one-line `useEffect([state])` mirror. Comment tag pattern:
```typescript
// phase-29: wsStateRef mirrors wsState so WS onclose can read current value
// without stale-closure inside the retry-scheduler closure. Pattern mirrors
// PrettyView.tsx statusRef (L1240-1245).
```

### Structural-Grep Test with Planted Comment-Tag Anchor
**Source:** `Terminal.wiring.test.ts:544-627, 728-810` (quick-260809-eqk block — anchor pattern documented at L544-547 header).
**Apply to:** SPEC req 2 (only-resolving-spinner during phase=resolving) + SPEC req 6 (per-phase mount gates on each overlay) + SPEC req 5 (no-setTimeout grep on hook).

Pattern:
1. Plant a `phase-29: <purpose>` comment tag in the source at the site under test.
2. In the test: `const idx = src.indexOf("phase-29: ..."); expect(idx).toBeGreaterThan(0);`
3. `const block = src.slice(idx, idx + N);` — window sized for the effect body.
4. `expect(block).toContain(...)` / `.toMatch(...)` for each load-bearing token.

Reformatting-safe (survives Prettier); refactor-safe (comment tag survives; grep for pattern still finds the same site).

### Delay-Arm useEffect
**Source:** `PrettyView.tsx:1416-1436` (patch #74's 350ms `showOverlay` delay-arm — the template).
**Apply to:** the new hook's ~150ms spinner-mount delay (D-04). Exact shape reused:
```typescript
useEffect(() => {
  if (phase !== "resolving") {
    setShowSpinner(false);
    return;
  }
  const t = setTimeout(() => {
    setShowSpinner(true);
  }, 150);
  return () => {
    clearTimeout(t);
  };
}, [phase]);
```
This is the ONLY setTimeout allowed in the hook per SPEC req 5 grep-gate. NO wall-clock resolve-to-error.

### Full-suite Green Precondition (SPEC constraint)
**Source:** SPEC.md Constraints section.
**Apply to:** planner MUST audit every existing test in `PrettyView.test.tsx` / `PrettyViewLoadingOverlay.test.tsx` / `SessionHoldingOverlay.test.tsx` / `DormancyOverlay.test.tsx` / `session-recycling-store.test.ts` for assertions that will break under the mount-gate rewire, and add updates alongside the code changes. `npx vitest run` must exit 0.

## No Analog Found

None. Every new file has a strong analog in the codebase — this phase is entirely a factoring/rewiring of existing patterns, not a novel data-flow or role.

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (PrettyView + all overlays + hook)
- `src/ui/state/` (session stores)
- `src/ui/features/terminal/` (structural-grep test pattern)
- `src/backend/claude-session/` (layer1-detect test-seam pattern)
- `src/ui/hooks/` (fork-convention hook location)

**Files scanned:** ~15 (PrettyView.tsx + 3 overlays + 4 test files + session-recycling-store + layer1-detect + layer1-detect.test + Terminal.wiring.test + use-pretty-view-uploads hook + claude-session-api types)

**Pattern extraction date:** 2026-08-10
