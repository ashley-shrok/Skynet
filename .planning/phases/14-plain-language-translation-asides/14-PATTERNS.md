# Phase 14: Plain-language translation asides — Pattern Map

**Mapped:** 2026-07-26
**Files analyzed:** 8 (5 frontend + 2 backend + 1 shared api)
**Analogs found:** 8 / 8

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/AsideBubble.tsx` (NEW) | component (message-bubble) | render-only | `src/ui/features/pretty-view/PlanPendingBubble.tsx` | exact — new bubble alongside existing bubble types |
| `src/ui/features/pretty-view/PrettyView.tsx` (MODIFY) | component (surface / message-stream host) | request-response + WS receive | `src/ui/features/pretty-view/PrettyView.tsx` L830-853 (existing bubble render loop) + L363-379 (WS event switch) | self — extends existing patterns in-place |
| `src/ui/features/pretty-view/ComposeBox.tsx` (MODIFY — morph) | component (compose bar + aux affordances) | prop-driven state morph | `src/ui/features/pretty-view/ComposeBox.tsx` L1422-1454 (inside-textarea Send) + L1150-1276 (aux button disable pattern) + L580-607 (isIdle watchdog reuse) | self — new `asideActive` prop threads into existing disable / morph patterns |
| `src/ui/api/claude-session-api.ts` (MODIFY — new event types) | shared api (WS wire-type discriminated union) | type-only | `src/ui/api/claude-session-api.ts` L113-120 (SessionHoldingEvent, SessionChangedEvent) + L153-157 (ConnectToPanePayload) | exact — sibling one-shape events on the same union |
| `src/backend/claude-session/claude-session-server.ts` (MODIFY — aside subsystem) | backend (WS handler + tmux poller) | polled request-response over SSH exec channel + WS broadcast | `src/backend/claude-session/claude-session-server.ts` L1494-1542 (context-pct poller — full 200-400ms cadence template) + L989-1013, L1018-1088 (client-message dispatch) | exact — same file, same connection lifetime, same exec-channel plumbing |
| `src/backend/ssh/tmux-helper.ts` (NO MODIFY — reuse only) | backend utility (SSH exec + tmux commands) | request-response | `src/backend/ssh/tmux-helper.ts` L21-50 (`execCommand`) + L184-197 (`queryPaneCurrentCommand`) | exact — direct reuse of `execCommand` for `capture-pane` and `send-keys` |
| `src/ui/features/pretty-view/PrettyView.test.tsx` (MODIFY — add aside tests) | test | render + WS-mock | `src/ui/features/pretty-view/ChatMessage.test.tsx` L14-50 (render + testing-library assertions) | role-match — new bubble type tested alongside existing bubbles |
| `src/backend/claude-session/claude-session-server.test.ts` (if exists — else add-inline coverage) | test | poll-loop + WS-mock | `src/backend/claude-session/claude-session-server.ts` inline structure of context-pct poller | role-match |

---

## Pattern Assignments

### `src/ui/features/pretty-view/AsideBubble.tsx` (NEW — component, render-only)

**Primary analog:** `src/ui/features/pretty-view/PlanPendingBubble.tsx` — smallest, cleanest bubble file; identical shape to what AsideBubble needs (self-contained flex-justify wrapper + inner bubble div with identity-hue treatment). Copy the wrapper skeleton verbatim, then swap in the AsideBubble-specific CSS (10px border + 3-layer neon glow from CONTEXT.md § Rendering).

**Secondary analog:** `src/ui/features/pretty-view/ChatMessage.tsx` L118-129 — the canonical identity-hue assistant-bubble gradient/border/shadow triplet that the AsideBubble background LAYERS BENEATH its own thicker border + neon glow (CONTEXT.md: "same identity-hue gradient as normal assistant bubbles"). Do NOT touch ChatMessage — copy the class strings into AsideBubble.

**Tertiary analog:** `src/ui/features/pretty-view/ImageBubble.tsx` L55-93 — reference for how a NEW bubble type wraps content that is NOT prose (no markdown pipeline) but IS text-with-optional-decoration. AsideBubble content is plain agent voice; a `whitespace-pre-wrap` div plus optional dismiss affordance suffices (dismiss lives in ComposeBox morph, not in the bubble itself per CONTEXT.md § ComposeBox morph).

**Imports pattern to fork** (PlanPendingBubble.tsx L29-30):
```tsx
import { cn } from "@/lib/utils";
// AsideBubble does NOT need lucide icons in the bubble itself (dismiss X lives on
// ComposeBox); if the copy wants a subtle sparkles/lightbulb glyph as an aside
// marker, `import { Sparkles } from "lucide-react";` follows the exact same
// pattern PlanPendingBubble uses for ClipboardList.
```

**Wrapper + bubble skeleton to fork** (PlanPendingBubble.tsx L32-60):
```tsx
export function AsideBubble({ text, glow = 1.0, borderWidthPx = 10 }: AsideBubbleProps) {
  return (
    <div className={cn("flex", "justify-start")}>
      <div
        role="note"
        aria-label="Plain-language aside from the identity"
        className={cn(
          // Base identity-hue treatment — LIFTED VERBATIM from ChatMessage.tsx L124-127.
          "leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
          "text-[#fbf5e8]",
          // Prose pipeline (matches ChatMessage assistant branch — Inter font + prose-invert).
          "prose prose-sm max-w-none prose-invert",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        )}
        style={{
          // Aside-specific overrides: thick opaque hue border + 3-layer neon glow.
          // Border-width comes from prop (default 10px per CONTEXT.md); glow uses the
          // `glow` prop as a multiplier on each layer's alpha so future dial-back is one prop.
          borderStyle: "solid",
          borderColor: "hsla(var(--pv-id-hue), 90%, 65%, 1)",
          borderWidth: `${borderWidthPx}px`,
          boxShadow: [
            `0 0 12px hsla(var(--pv-id-hue), 100%, 60%, ${0.7 * glow})`,
            `0 0 32px hsla(var(--pv-id-hue), 100%, 55%, ${0.5 * glow})`,
            `0 0 64px hsla(var(--pv-id-hue), 100%, 50%, ${0.3 * glow})`,
            // Additive: preserve ChatMessage's depth shadow + inner rim so the aside doesn't
            // lose the glass depth character while gaining the neon glow.
            "0 8px 24px rgba(0,0,0,0.5)",
            "0 1px 0 rgba(255,220,170,0.18) inset",
          ].join(", "),
        }}
      >
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}
```

**Rationale for arbitrary-class vs inline-style split (from ChatMessage.tsx L124-127 pattern):** ChatMessage / ImageBubble / PlanPendingBubble use Tailwind arbitrary-value classes for the identity-hue treatment because those classes are stable across every render (JIT can pre-compile them). AsideBubble uses inline `style` for the border-width and glow multiplier because they're prop-driven (JIT can't compile a `border-[${var}px]` at build time). This split is consistent with the codebase — the aside-visual-snippet.js prototype Ashley signed off on also uses inline styles for the tunable pieces.

---

### `src/ui/features/pretty-view/PrettyView.tsx` (MODIFY — mount AsideBubble, handle new WS events)

**Analog:** self — every insertion point already exists.

**WS event switch — new cases** (fork the shape at PrettyView.tsx L363-379):
```tsx
// Current shape (L363-379) — add new cases identical to this pattern:
switch (parsed.type) {
  case "session": { setStatus("streaming"); break; }
  case "message": { setMessages((prev) => appendDedup(prev, parsed)); break; }
  case "image": { setMessages((prev) => appendDedup(prev, parsed)); break; }
  case "inactive": { /* ... */ break; }
  // NEW cases — same setState-in-switch pattern:
  case "aside_ready": { setAsideText(parsed.text); break; }
  case "aside_dismissed": { setAsideText(null); break; }
}
```

**Bubble render slot** — insert at PrettyView.tsx L852-853 (immediately after the `{planPending && <PlanPendingBubble />}` line, which is currently the LAST rendered child inside `<div ref={contentRef} className="flex flex-col gap-[18px]">`):
```tsx
{planPending && <PlanPendingBubble />}
{asideText && <AsideBubble text={asideText} />}   // NEW — pinned at bottom in-flow
```

**Why this slot is correct (CONTEXT.md § Rendering):** the aside must sit "at the very bottom of the pretty-view message-bubble list, IN-flow inside the scrollable stream." The existing `contentRef` div at L818 IS that scrollable content; `<PlanPendingBubble />` is currently the last child, so placing `<AsideBubble />` AFTER it inherits the "pinned at bottom" property automatically. The `useAutoScroll` ResizeObserver on `contentRef` (L818) will re-pin the viewport to the bottom when the AsideBubble mounts — no new scroll logic needed. This IS how PlanPendingBubble and WipBubble already work (L852-853); AsideBubble is a sibling.

**ComposeBox morph plumbing** — thread `asideText != null` as a new prop into the existing ComposeBox mount at PrettyView.tsx L936-975:
```tsx
{onSend && status === "streaming" && (
  <ComposeBox
    onSend={onSend}
    /* … existing 15 props … */
    // NEW:
    asideActive={asideText !== null}
    onAsideDismiss={() => {
      // Optimistic clear on click (CONTEXT.md § Dismiss step 1-2).
      setAsideText(null);
      // Then WS-send the dismiss (CONTEXT.md § Dismiss step 3).
      wsRef.current?.send(JSON.stringify({
        type: "aside_dismissed",
        hostId,
        tmuxSession,
      }));
    }}
  />
)}
```

**Aside state** — declare alongside the existing `useState<...>()` block at PrettyView.tsx L141-210:
```tsx
// Phase 14: currently-displayed aside for this session. null = no aside;
// string = aside text (backend-extracted /btw answer, ready to render).
// Backend is the sole source of truth — this state is derived from
// aside_ready / aside_dismissed WS frames, never from local timers or
// optimistic prediction (except the optimistic clear on X click).
const [asideText, setAsideText] = useState<string | null>(null);
```

**Fresh-pane reset** — extend the PrettyView.tsx L316-329 reset block:
```tsx
if (paneKey !== paneKeyRef.current) {
  // … existing setMessages([]) / setStatus("connecting") / etc. resets …
  setAsideText(null);   // NEW — same shape as setPlanPending(null) etc.
}
```

---

### `src/ui/features/pretty-view/ComposeBox.tsx` (MODIFY — morph on asideActive)

**Analog:** self — the disable pattern for aux buttons already exists (L1150-1276); the inside-textarea Send button (L1422-1454) is where the X-morph goes.

**New props** — add to the existing `ComposeBoxProps` interface at L89-195:
```tsx
// Phase 14: when true, the ComposeBox is in ASIDE-DISPLAYED mode.
// Send button morphs to an X icon (tooltip "Resume"). Queue-message,
// thumbs-up, reset-session all disable/grey (existing `canSend===false`
// disable pattern reused — see L1154, L1212, L998). Textarea remains
// editable and its content is preserved (per CONTEXT.md § ComposeBox morph).
asideActive?: boolean;
// Phase 14: fired when the X (Resume) affordance is clicked. Parent
// (PrettyView) optimistically clears aside display + WS-sends aside_dismissed.
onAsideDismiss?: () => void;
```

**Existing aux-button disable pattern to reuse** (L1150-1276 — three buttons all use `disabled={canSend === false}` or similar):
```tsx
// Current pattern (L1154 paperclip; identical at L1212 thumbs-up, L998 reset):
disabled={canSend === false}
// Phase 14 aux-button disable extension — replace with:
disabled={canSend === false || asideActive === true}
```
Apply this to ALL FOUR aux buttons (paperclip L1150, interrupt L1180 if wired, thumbs-up L1208, queue L1239) plus the meter's reset cell button (L995-1024, `disabled={canSend === false}` at L998).

**Send button morph** — the current inside-textarea Send button at L1422-1454 is a plain `<button type="button">` with a paper-plane inline SVG. Fork the SAME element to switch its icon and onClick based on `asideActive`:
```tsx
// Current shape (L1422-1454):
<button
  type="button"
  onClick={() => { if (!sendDisabled) handleSend(); }}
  disabled={sendDisabled}
  aria-label="Send"
  title="Send"
  className={cn(
    "absolute right-1 bottom-0.5",
    "p-2",
    "text-[rgba(240,235,224,0.3)]",
    "hover:text-[rgba(240,235,224,0.9)]",
    /* … */
  )}
>
  <svg …>{/* paper-plane path */}</svg>
</button>

// Phase 14 morph — same button, branch on asideActive:
<button
  type="button"
  onClick={() => {
    if (asideActive) { onAsideDismiss?.(); return; }
    if (!sendDisabled) handleSend();
  }}
  disabled={asideActive ? false : sendDisabled}
  aria-label={asideActive ? "Resume" : "Send"}
  title={asideActive ? "Resume" : "Send"}
  className={cn(
    "absolute right-1 bottom-0.5",
    "p-2",
    // Distinct color when morphed to X so it visually separates from Send
    // (Ashley: "Style change to visually distinguish from send" per CONTEXT.md).
    asideActive
      ? "text-[hsla(var(--pv-id-hue),90%,72%,0.95)] hover:text-[hsla(var(--pv-id-hue),95%,82%,1)]"
      : "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
    /* … keep remaining classes … */
  )}
>
  {asideActive ? (
    // X icon — lucide `X` matches size + stroke of the paper-plane SVG's 24×24 slot.
    <X className="size-6" strokeWidth={2.25} aria-hidden="true" />
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    </svg>
  )}
</button>
```

**Textarea preservation** (CONTEXT.md § ComposeBox morph: "Textarea remains editable. Any partial draft text is preserved verbatim"): NO change needed. The existing `<Textarea>` at L1290-1376 has `disabled={queueArmed}` (patch #84's queue-armed lock). Do NOT add `|| asideActive` to that disable — per CONTEXT.md, textarea stays editable during aside. Existing draft persistence via patch #57's autosave (L36-49 of ComposeBox) automatically preserves the draft through the aside display window.

**Import extension** — add `X` to the lucide-react import at L2:
```tsx
import { Hourglass, Paperclip, RefreshCw, RotateCcw, Square, ThumbsUp, X } from "lucide-react";
```

---

### `src/ui/api/claude-session-api.ts` (MODIFY — new event types)

**Analog:** self — SessionHoldingEvent (L113-115) and SessionChangedEvent (L117-120) show the exact shape for one-tag WS events on this union. ConnectToPanePayload (L153-157) shows the client→server payload shape.

**New wire types to add** (extend the existing union at L133-151):
```tsx
// Phase 14: aside_ready — backend has extracted a /btw answer from the
// tmux BTW overlay and is delivering it to this client. Fires when a
// completed assistant turn triggers the /btw injection AND the BTW answer
// is captured (two consecutive stable poll reads showing the end-of-answer
// marker per CONTEXT.md § Extraction).
export type AsideReadyEvent = {
  type: "aside_ready";
  text: string;   // extracted /btw answer text; may span multiple lines
};

// Phase 14: aside_dismissed — backend observed the BTW overlay disappearing
// (either from a client-initiated Escape, or from any other cause — Ashley
// SSH-attaching and pressing Escape herself, tmux death, etc.). Broadcast
// to ALL clients subscribed to this session's WS stream (cross-tab dismiss
// coherence per CONTEXT.md § Dismiss step 5 and ASIDE-11).
export type AsideDismissedEvent = {
  type: "aside_dismissed";
};

// Extend the discriminated union at L133-151:
export type ClaudeSessionServerEvent =
  | SessionMetaEvent
  | MessageEvent
  | ImageEvent
  | InactiveEvent
  | ContextPctEvent
  | HarnessTasksEvent
  | BackgroundedAgentsEvent
  | BackgroundedShellsEvent
  | PlanPendingEvent
  | SessionHoldingEvent
  | SessionChangedEvent
  | TailErrorEvent
  | ErrorEvent
  | AsideReadyEvent           // NEW
  | AsideDismissedEvent       // NEW
  | IdentityBountiesEvent
  | /* … */;

// Phase 14: client-initiated dismiss command. Mirrors ConnectToPanePayload
// (L153-157) shape — { type, hostId, tmuxSession }. Backend routes this to
// the SSHed identity-tmux to send Escape into the BTW overlay.
export type AsideDismissedPayload = {
  type: "aside_dismissed";
  hostId: number;
  tmuxSession: string;
};
```

---

### `src/backend/claude-session/claude-session-server.ts` (MODIFY — aside subsystem)

**Primary analog:** the context-pct poller at L1494-1542 — the closest full-shape template for a "poll tmux every ~200-400ms via `execCommand` on the same multiplexed SSH connection, parse the pane output, emit on a stable detection, guard against slow-poll pileups with an inFlight flag." This is what the aside extraction poller wants to be. Copy the ENTIRE structure and swap the scrape logic + emit shape.

**Secondary analog:** the client-message dispatch at L989-1088 — shows the exact `msg.type === "..."` guard shape for new client→server messages. `aside_dismissed` handling slots in here alongside `identity:list-bounties`.

**Tertiary analog:** `src/backend/ssh/tmux-helper.ts` L21-50 `execCommand` — the single primitive used for both the `capture-pane` poll AND the `send-keys` injection. No new subsystem needed.

**Extraction poller structure to fork** (L1494-1542):
```typescript
// Current context-pct poller (analog):
const captureCmd = `tmux capture-pane -p -t '${tmuxSession}'`;
contextPctTimer = setInterval(() => {
  if (stopped || ws.readyState !== WebSocket.OPEN) return;
  if (!sshConn) return;
  if (contextPctInFlight) return; // guard against slow SSH pileups
  contextPctInFlight = true;
  const connSnapshot = sshConn;
  execCommand(connSnapshot, captureCmd)
    .then((output) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      const lines = output.split("\n").slice(-8);
      /* parse … */
      ws.send(JSON.stringify({ type: "context_pct", pct }));
    })
    .catch(() => { /* silent */ })
    .finally(() => { contextPctInFlight = false; });
}, CONTEXT_PCT_INTERVAL_MS);

// Phase 14 aside-extraction poller — same shape, different interval + parse:
const ASIDE_POLL_INTERVAL_MS = 300;   // CONTEXT.md § Extraction: ~200-400ms cadence
const ASIDE_END_MARKER = "Esc to close";  // CONTEXT.md § Specific Ideas
// Use scrollback -S -N to catch multi-line answers exceeding the visible pane
// (CONTEXT.md § Extraction: "primary path is grabbing from capture-pane -S -<N>").
const asideCaptureCmd = `tmux capture-pane -p -S -200 -t '${tmuxSession}'`;
let lastStableCapture: string | null = null;   // for "two consecutive polls with identical pane content" (CONTEXT.md § Specifics)
let asideExtractionInFlight = false;
// Poller lifecycle: armed when a completed assistant turn AND idle-window signal
// AND active-viewer-count >= 1 (see "Trigger derivation" below). Poller polls
// until end-marker + stability, then emits aside_ready, then disarms.
const asideExtractionTimer = setInterval(() => {
  if (stopped || ws.readyState !== WebSocket.OPEN) return;
  if (!sshConn) return;
  if (asideExtractionInFlight) return;
  if (!asideExtractionArmed) return;   // gate — only poll when we've injected /btw and are awaiting
  asideExtractionInFlight = true;
  const connSnapshot = sshConn;
  execCommand(connSnapshot, asideCaptureCmd)
    .then((output) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!output.includes(ASIDE_END_MARKER)) return;   // still streaming
      // Stability: current capture must equal previous capture for two-in-a-row.
      if (lastStableCapture !== output) {
        lastStableCapture = output;
        return;
      }
      // Extract answer text between the echoed `/btw` line and the end-marker line.
      const asideText = extractBtwAnswer(output, ASIDE_END_MARKER);
      if (asideText) {
        ws.send(JSON.stringify({ type: "aside_ready", text: asideText }));
        asideExtractionArmed = false;   // disarm; won't re-fire until next trigger
        lastStableCapture = null;
      }
    })
    .catch(() => { /* silent — same posture as context-pct */ })
    .finally(() => { asideExtractionInFlight = false; });
}, ASIDE_POLL_INTERVAL_MS);
```

**Injection pattern** (reuse `execCommand` from `src/backend/ssh/tmux-helper.ts` L21-50; NO new function needed):
```typescript
// CONTEXT.md § Injection: fixed prompt text.
const BTW_PROMPT = "/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.";

async function injectBtw(conn: SSHClientType, tmuxSession: string) {
  // Same shellQuote / single-quote-wrap convention as L1498 (captureCmd).
  // send-keys uses two args: the payload string + the literal `Enter` key.
  // Pattern taken from src/backend/ssh/terminal.ts L760 (existing send-keys Enter usage).
  await execCommand(
    conn,
    `tmux send-keys -t '${tmuxSession}' ${JSON.stringify(BTW_PROMPT)} Enter`,
  );
}

async function sendEscapeToBtw(conn: SSHClientType, tmuxSession: string) {
  // Escape closes the BTW overlay cleanly per kumquat-test finding.
  await execCommand(
    conn,
    `tmux send-keys -t '${tmuxSession}' Escape`,
  );
}
```

**Client-message dispatch for `aside_dismissed`** — slot into the existing switch pattern at L989-1088:
```typescript
// Current shape (L1018):
if (msg.type === "identity:list-bounties") { /* … */ return; }

// Phase 14 — same guard shape:
if (msg.type === "aside_dismissed") {
  // CONTEXT.md § Dismiss step 4: backend sends Escape into tmux.
  // Uses the pane's existing sshConn (same connection lifetime as the WS).
  if (sshConn && currentTmuxSession) {
    try {
      await sendEscapeToBtw(sshConn, currentTmuxSession);
      // Broadcast happens NEXT poll-cycle when the poller sees the marker
      // disappear — CONTEXT.md § State model: tmux overlay IS source of truth,
      // do NOT emit aside_dismissed here optimistically. The client already
      // cleared its display optimistically (CONTEXT.md § Dismiss step 1).
    } catch (err) {
      sshLogger.info("aside_dismissed Escape send failed", { operation: "aside_dismiss", err });
    }
  }
  return;
}
```

**Trigger derivation** (CONTEXT.md § Trigger reuses the WIP-indicator idle-window signal):
- The backend already emits `type:"wip"` transitions and (via `src/backend/ssh/terminal.ts` line ~1178-1184 in the frontend Terminal.tsx) drives the frontend's `isIdle` state.
- New backend logic per session-WS: watch the existing WIP transitions (or the frontend can drive the trigger by sending a new `aside_arm` payload from PrettyView when the isIdle window elapses). Prefer backend-driven: when the existing `wip` transition fires with `active:false` AND the previous state was `active:true` AND active-viewer-count >= 1 (i.e. WS is connected), fire `injectBtw` + arm the extraction poller.
- **Active-viewer count**: derive from currently-connected WS subscriptions on this session. Since each pretty-view WS is per-connection (L109 `wss.on("connection", ...)`), tracking is a Map<sessionKey, Set<WebSocket>> at module scope. CONTEXT.md § Specifics: "Active-viewer count for triggering: derived from currently-connected pretty-view WS subscriptions."

**Cross-tab broadcast** (CONTEXT.md § Dismiss step 5, ASIDE-11):
- The wire is already there per-WS via `ws.send(...)`. For cross-tab fan-out, iterate `wss.clients` filtered by matching `(hostId, tmuxSession)` — the module-scope `WebSocketServer` at L107 exposes `.clients`.
- Track per-WS `{hostId, tmuxSession}` in a WeakMap or in-connection state (already set at L1461-1462: `currentHostId = hostId; currentTmuxSession = tmuxSession;` — just make these queryable from outside the current WS closure).

**Emission of aside_dismissed on marker disappearance** — inside the same poller: when a prior `lastStableCapture` contained the marker AND the current `output` no longer contains it, broadcast `{type:"aside_dismissed"}` to ALL sessions-matching WS clients (cross-tab coherence). Reset all aside state.

**Tab-close / re-attach recovery** (CONTEXT.md § Tab close / re-attach):
- On `connectToPane` (L1334 handler), after the discovery succeeds and BEFORE arming the normal poller, do ONE pane-probe via `execCommand(conn, asideCaptureCmd)`.
- If the output contains `ASIDE_END_MARKER`, extract the answer text and emit `{type:"aside_ready", text:...}` immediately.
- This is a one-shot probe on mount — same shape as the initial discovery call at L1406. NO new subsystem.

---

### `src/backend/ssh/tmux-helper.ts` (NO MODIFY — reuse only)

Do NOT modify. The Phase 14 backend calls `execCommand(conn, cmd)` for both `capture-pane` polling and `send-keys` injection. Both are exact patterns of what `queryPaneCurrentCommand` (L184-197) and `queryPanePid` (L207-222) already do — one-shot exec, single-quote-wrapped session name, silent-null on failure. If the planner feels a `sendKeysToTmuxSession(conn, session, keys[])` helper wants extracting, that's a REFACTOR decision — not required for Phase 14 correctness. Prefer inline `execCommand` calls in claude-session-server.ts (matches the context-pct poller precedent at L1498).

---

### `src/ui/features/pretty-view/PrettyView.test.tsx` (MODIFY — add aside tests)

**Analog:** `src/ui/features/pretty-view/ChatMessage.test.tsx` L14-50 — shows the vitest + @testing-library/react + render + screen.getByText / getAllByTestId shape used in this codebase.

**Test structure to fork** (ChatMessage.test.tsx L14-50):
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsideBubble } from "./AsideBubble";

describe("AsideBubble — Phase 14 rendering", () => {
  it("renders the aside text inside a bubble with identity-hue treatment", () => {
    render(<AsideBubble text="the agent is doing X" />);
    expect(screen.getByRole("note")).toBeTruthy();
    expect(screen.getByText(/the agent is doing X/)).toBeTruthy();
  });

  it("accepts a glow multiplier prop", () => {
    render(<AsideBubble text="hi" glow={0.5} />);
    // Assert the box-shadow inline style includes the halved alpha values.
    // (Adapt to the render's actual style-inspection pattern.)
  });

  it("accepts a configurable border width", () => {
    render(<AsideBubble text="hi" borderWidthPx={6} />);
    // Assert inline style includes borderWidth: 6px.
  });
});
```

For PrettyView integration tests: fork the existing `PrettyView.test.tsx` WS-mock scaffolding — search for the pattern that dispatches a fake `{type:"message"}` frame and swap in `{type:"aside_ready", text:"..."}` frames. Verify AsideBubble mounts, ComposeBox morphs (button aria-label = "Resume", aux buttons disabled).

---

## Shared Patterns

### Identity-hue Glass depth (assistant bubble treatment)
**Source:** `src/ui/features/pretty-view/ChatMessage.tsx` L118-129 (canonical); mirrored byte-for-byte in `ImageBubble.tsx` L64-71 and `PlanPendingBubble.tsx` L45-52.
**Apply to:** `AsideBubble.tsx` — copy the gradient / prose-invert / Inter-font trio verbatim, ADD the thick border + neon glow on top.
```tsx
"bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
"text-[#fbf5e8]",
"border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",   // AsideBubble overrides this with inline 10px opaque hue border
"shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
"backdrop-blur-xl saturate-150",
"[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
"font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
```

### WS event switch shape (frontend)
**Source:** `src/ui/features/pretty-view/PrettyView.tsx` L363-379.
**Apply to:** new `aside_ready` and `aside_dismissed` cases — same setState-in-switch shape.

### Backend poller pattern (exec-channel over shared SSH conn)
**Source:** `src/backend/claude-session/claude-session-server.ts` L1494-1542 (context-pct poller).
**Apply to:** the aside extraction poller — same `setInterval` + `execCommand` + `if (stopped || ws.readyState)` + `inFlight` guard + `.catch(silent)` + `.finally(reset guard)`.

### tmux exec-channel command shape
**Source:** `src/backend/ssh/tmux-helper.ts` L21-50 `execCommand` + `queryPaneCurrentCommand` L184-197.
**Apply to:** BOTH `tmux capture-pane -p -S -200 -t '<session>'` (extraction) AND `tmux send-keys -t '<session>' "<payload>" Enter` / `tmux send-keys -t '<session>' Escape` (injection / dismiss). Same single-quote-wrap. Same silent-on-catch posture.

### Send-keys precedent
**Source:** `src/backend/ssh/terminal.ts` L760 (`tmux send-keys -t ${shellQuote(tmuxTarget)} Enter`) — the split-send Enter path from patch #40 / #100 / #118.
**Apply to:** aside `/btw` injection — same `send-keys` invocation shape, on the SAME session's SSH connection (`sshConn` from the WS scope), same `shellQuote` sanitization.

### Aux-button disable idiom
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx` L998, L1154, L1212, L1243 — every aux button uses `disabled={canSend === false}` (or a compound predicate with additional gates like `queueDisabled`).
**Apply to:** the ComposeBox morph — extend each button's `disabled` predicate to `disabled={canSend === false || asideActive === true}`. Do NOT add a new disable-all wrapper; the pattern is per-button explicit gates.

### Idle-window signal reuse
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx` L580-607 (Queue button's idle watchdog — waits for `isIdle === true` to hold before firing).
**Apply to:** the aside-fire trigger — CONTEXT.md § Trigger says "Reuses the ComposeBox WIP-indicator's idle-window signal verbatim." The signal is the backend's `type:"idle"` WS frame received by `src/ui/features/terminal/Terminal.tsx` L1178-1184 and threaded down to PrettyView / ComposeBox as the `isIdle` prop. The BACKEND already knows when idle transitions happen (it emits the frame); the aside fire trigger should live on the backend where the WIP idle detection ALREADY runs, avoiding the parallel-debounce anti-pattern CONTEXT.md § Trigger explicitly forbids.

### Fresh-pane state reset
**Source:** `src/ui/features/pretty-view/PrettyView.tsx` L316-329.
**Apply to:** add `setAsideText(null)` to the reset block so a new pane mount starts clean.

---

## No Analog Found

None — every Phase 14 file has a clear analog in the existing pretty-view or backend session-tail codebase. This phase is 100% additive layering on Phase 1 + Phase 2 + Phase 4 + Phase 9 infrastructure that already ships.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (all component files)
- `src/ui/api/` (WS wire-type surface)
- `src/backend/claude-session/` (WS server + session-tail)
- `src/backend/ssh/` (tmux helper + terminal.ts send-keys precedent)
- `src/ui/features/terminal/` (isIdle signal source + session-hue helper)

**Files scanned:** 12 (5 pretty-view components + 1 claude-session-api + 3 backend claude-session/ssh files + 1 session-hue helper + 2 test files)

**Pattern extraction date:** 2026-07-26

**Analog fidelity note:** every Phase 14 excerpt cited is byte-current as of 2026-07-26 HEAD. The `--pv-id-hue` CSS var (PrettyView.tsx L702), the identity-hue gradient / border / shadow triplet (ChatMessage.tsx L124-127), the aux-button disable pattern (ComposeBox.tsx L998 / L1154 / L1212 / L1243), the inside-textarea Send button (ComposeBox.tsx L1422-1454), the context-pct poller (claude-session-server.ts L1494-1542), the `execCommand` primitive (tmux-helper.ts L21-50), and the send-keys precedent (terminal.ts L760) are all locked, load-bearing patterns the planner should treat as authoritative.
