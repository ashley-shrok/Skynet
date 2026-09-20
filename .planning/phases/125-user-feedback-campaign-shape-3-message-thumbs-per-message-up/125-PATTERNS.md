# Phase 125: user-feedback campaign shape 3 — message thumbs - Pattern Map

**Mapped:** 2026-09-20
**Files analyzed:** 4 (2 modified + 1 new test + 1 optional new component)
**Analogs found:** 4 / 4 (100% coverage, all in-repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/ChatMessage.tsx` **(MODIFY)** | component | request-response + event-driven | **self** (Phase 122 already imports lucide `ThumbsUp`; assistant-branch already lives here) | exact — same file |
| `src/ui/features/pretty-view/PrettyView.tsx` **(MODIFY)** | container/parent | request-response | `src/ui/AppShell.tsx` L357+L4165-4212 (feedbackOpen atom + FeedbackModal mount + submit/dismiss → postFeedback + toast) | role-match |
| `src/ui/features/pretty-view/ChatMessage.feedback-thumbs.test.tsx` **(NEW)** | test | — | `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx` (shape-2 test), `ChatMessage.speak.test.tsx` (colocated ChatMessage test with voice-api + player mocks) | exact — combined |
| `src/ui/features/pretty-view/ActionStrip.tsx` **(OPTIONAL NEW — planner picks inline-vs-extract)** | component | request-response | inline speak-button `<button>` in `ChatMessage.tsx` L603-692 | role-match |

**Read-only reference files** (imported, must NOT be modified per D-36):
- `src/ui/feedback/feedback-store.ts` — `useFeedbackEnabled()` hook
- `src/ui/feedback/feedback-api.ts` — `postFeedback()` + `FeedbackPayload` type
- `src/ui/feedback/FeedbackModal.tsx` — the modal component + `FeedbackModalProps`
- `sonner` (via `import { toast } from "sonner"`) — globally mounted Toaster at `src/main.tsx:243`
- `src/ui/features/pretty-view/RelayInboundBubble.tsx` — verified: keeps its own in-bubble speak; shape 3 must not touch it (D-12)
- `src/ui/features/pretty-view/WaitingBubble.tsx` — verified: no speak, no thumbs (D-13)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — inherited unchanged from shape 2 (D-36)

---

## Pattern Assignments

### `src/ui/features/pretty-view/ChatMessage.tsx` (component — MODIFY)

**Analog: the file itself.** The current in-bubble speak button is the exact block that must become conditional, and every visual state cue must be preserved when the button relocates to the strip.

#### Imports pattern (L1-21)
The file already imports `ThumbsUp` from lucide-react (L5 — used by `isQuickReply`). Shape 3 will add `ThumbsDown` from the same import and add three new imports:
```typescript
import { ThumbsUp, Volume2, Loader2, Pause, Play } from "lucide-react";        // L5 — add ThumbsDown
import { cn } from "@/lib/utils";                                              // L6
// ADD (shape 3):
import { useFeedbackEnabled } from "@/feedback/feedback-store";
import { postFeedback } from "@/feedback/feedback-api";
import { toast } from "sonner";
```

#### The in-bubble speak button — the block that must become conditional (L603-692)
This is the entire block that must be gated on `!feedbackEnabled`. It sits inside the `{!isUser && (...)}` wrapper and is the ONLY place the speak button renders today:
```tsx
{!isUser && (
  <button
    type="button"
    onPointerDown={(e) => {
      longPressFiredRef.current = false;
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressFiredRef.current = true;
        longPressTimerRef.current = null;
        if (eventId && onLongPressSpeak) onLongPressSpeak(eventId);
        void startSpeak("long-press");
      }, 500);
    }}
    onPointerMove={(e) => { /* … 10px drift cancels timer … */ }}
    onPointerCancel={() => { /* … */ }}
    onPointerUp={() => { /* … */ }}
    onClick={(e) => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        e.stopPropagation();
        return;
      }
      void onSpeakClick(e);
    }}
    aria-label={
      speakState === "playing" ? "Pause speaking"
        : speakState === "paused" ? "Resume speaking"
        : "Speak message"
    }
    style={{
      position: "absolute",              // ← IN-BUBBLE anchoring — LEAVES on feedback ON
      right: 6,
      bottom: 6,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: autoplayArmed
        ? "hsla(var(--pv-id-hue),60%,70%,0.28)"    // ← identity-hue tint when autoplay armed
        : "rgba(0,0,0,0.28)",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: autoplayArmed
        ? "hsla(var(--pv-id-hue),70%,70%,0.35)"
        : "rgba(255,255,255,0.10)",
      color: "rgba(255,220,170,0.72)",
      opacity: 0.62,                       // ← RESTING WEIGHT — must be preserved in the strip (D-07)
      cursor: "pointer",
      transition: "opacity 120ms, background 120ms, transform 80ms",
    }}
    className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
    // ↑ HOVER LIFT + TOUCH BASELINE — must be preserved in strip (D-07/D-08)
  >
    {speakState === "loading" ? (
      <Loader2 size={16} className="animate-spin" />       // ← all four glyph states — must be preserved (D-15)
    ) : speakState === "playing" ? (
      <Pause size={16} />
    ) : speakState === "paused" ? (
      <Play size={16} />
    ) : (
      <Volume2 size={16} />
    )}
  </button>
)}
```

**What shape 3 changes:**
1. Wrap this entire block in `{!feedbackEnabled && (…)}` — when feedback is ON, this DOM node is ABSENT (D-03).
2. Duplicate/lift the same button structure into a strip-mode block that renders BELOW the bubble div (i.e., a sibling of the outer bubble div returned at L438-694) but INSIDE the outer flex wrapper — see D-04 (strip is anchored to bubble's outer-left edge).
3. In strip mode, drop `position:absolute / right / bottom` (the strip is normal flow). Everything else (`autoplayArmed` hue tint, hover-lift class, touch baseline class, glyph state machine) carries over verbatim per D-15/D-17.

#### The bubble's padding-collapse class-swap (L448-498)
The bubble div's className carries the asymmetric padding pocket for the in-bubble speak button. Shape 3 must collapse it symmetrically when feedback is ON (D-03):
```tsx
className={cn(
  "pv-bubble",
  "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
  "rounded-[var(--radius-pv-bubble)]",
  isUser ? "px-[12px] py-[7px]" : "pl-[12px] pr-[42px] py-[7px]",   // ← pr-[42px] IS the speak-button pocket
  //  ↑ SHAPE 3: when !isUser AND feedbackEnabled, must become "pl-[12px] pr-[12px] py-[7px]" (D-03)
  "backdrop-blur-xl saturate-150",
  // …
  isUser
    ? cn(/* user bubble treatment */)
    : cn(
        // Assistant bubble — identity-hue tint. Preserved verbatim in both modes.
        "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
        "text-[#fbf5e8]",
        "border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
        // …
        "prose-invert",
      ),
)}
```
**Recommended class-swap:** replace the ternary `isUser ? "px-[12px] py-[7px]" : "pl-[12px] pr-[42px] py-[7px]"` with a three-way expression that picks `pl-[12px] pr-[12px] py-[7px]` when assistant AND feedbackEnabled, else the current two branches.

#### The `!isUser` gate (L603) as the anchor
The strip must render ONLY for assistant bubbles — same gate as the in-bubble speak button. D-11 lock:
```tsx
{!isUser && (
  // Existing speak-button block (currently unconditional at line 604) —
  // shape 3 splits this into: !feedbackEnabled → in-bubble speak (unchanged);
  //                          feedbackEnabled  → strip below the bubble.
)}
```

#### The outer flex wrapper (L438-439) — where the strip attaches
```tsx
return (
  <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>   // ← outer flex wrapper
    <div ... className={cn("pv-bubble", ...)}>                              // ← bubble div (L440-693)
      {/* bubble content + in-bubble speak button */}
    </div>
  </div>
);
```
**Recommended:** in strip mode, wrap the current outer `<div className="flex">` returned at L438-694 in a NEW outer `<div>` that stacks the bubble ROW and the strip ROW vertically — OR restructure the return to render `bubble-div + strip-div` as children of a `flex flex-col items-start` wrapper (`items-start` per D-04 left-edge alignment). Planner's discretion — either works.

#### Instance identifier for messageRef (D-32)
`eventId` already flows in as a prop (L69, L81) and is used throughout for autoplay dedup and the affordance handler. It is a `string | undefined`. Shape 3's thumbs handlers gate on `eventId != null` and pass it as `messageRef`:
```typescript
onLongPressSpeak?: (eventId: string) => void;           // L84 — existing precedent for eventId-keyed handler
```

#### Pressed-state storage recommendation (D-40 planner-pick)
`ChatMessage` already uses `useState` for `speakState` (L120):
```typescript
const [speakState, setSpeakState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
```
Same pattern applies for pressed state:
```typescript
// Option (a) — simplest, per D-40. State scoped to this ChatMessage instance so it
// resets when the message unhydrates (component unmounts on conversation switch /
// page reload / hydration flush) per D-30.
const [thumbsUpPressed, setThumbsUpPressed] = useState<boolean>(false);
const [thumbsDownPressed, setThumbsDownPressed] = useState<boolean>(false);
```

---

### `src/ui/features/pretty-view/PrettyView.tsx` (container — MODIFY)

**Analog:** `src/ui/AppShell.tsx` L357 + L4165-4212 — the shape-2 "own the modal-open state + build payload + fire toast" template.

#### The invocation site to touch (L3951-3970)
```tsx
<ChatMessage
  role={m.role}
  content={m.content}
  identityVoice={pvIdentity?.voice ?? null}
  ts={m.ts}
  eventId={m.eventId}
  autoplayArmed={autoplayArmed}
  autoplayTargetEventId={autoplayTargetEventId}
  onLongPressSpeak={handleLongPressSpeak}
  onOpenEditor={handleOpenEditor}
  pendingState={m.pendingState ?? null}
/>
```
**Shape 3 adds** (D-38 planner-preferred pattern):
```tsx
<ChatMessage
  /* … existing props … */
  onThumbsUp={handleThumbsUp}          // (eventId, exchangeText) => void — fires postFeedback + toast
  onThumbsDown={handleThumbsDown}      // (eventId, exchangeText) => void — opens FeedbackModal in thumbs_down variant
/>
```
The `.map()` iteration at L3894-3973 already walks `effectiveMessages` (L710 — `StreamEvent[]`). To compute `exchangeText` for each assistant message per D-33/D-34, the map body can look up the PREVIOUS chat-message entry (the prompting user turn) — the array is already chronologically sorted via the insertion-sort at L346-361.

#### The AppShell shape-2 template (analog for FeedbackModal ownership)
**src/ui/AppShell.tsx L357-359** — the modal open-state atom:
```tsx
const [feedbackOpen, setFeedbackOpen] = useState<
  false | "general" | "thumbs_down"
>(false);
```

**src/ui/AppShell.tsx L4165-4212** — the FeedbackModal mount + submit/dismiss handlers with `postFeedback` + `toast.success` — this is the EXACT pattern shape 3 replicates at the PrettyView level (or reuses AppShell's existing mount if the planner threads through the same atom):
```tsx
<FeedbackModal
  open={feedbackOpen !== false}
  variant={feedbackOpen === false ? "general" : feedbackOpen}
  onOpenChange={(next) => {
    if (!next) setFeedbackOpen(false);
  }}
  onSubmit={(userNote) => {
    const variant = feedbackOpen === false ? "general" : feedbackOpen;
    const payload =
      variant === "thumbs_down"
        ? {
            kind: "thumbs_down" as const,
            userNote,
            messageRef: "dev-fake-msg",              // ← shape 3 substitutes the real eventId here
            exchangeText:
              "User asked: Q\n\nAssistant replied: A",   // ← shape 3 substitutes the computed exchange
          }
        : { kind: "general" as const, userNote };
    void postFeedback(payload);
    toast.success("Thanks — feedback sent.", { duration: 2000 });
    setFeedbackOpen(false);
  }}
  onDismissWithoutSubmit={() => {
    void postFeedback({
      kind: "thumbs_down",
      userNote: "",
      messageRef: "dev-fake-msg",                 // ← shape 3 substitutes the real eventId
      exchangeText: "User asked: Q\n\nAssistant replied: A",  // ← real exchange here
    });
    toast.success("Thanks — feedback sent.", { duration: 2000 });
  }}
/>
```
**KEY insight — reuse vs new mount:** AppShell already mounts one `<FeedbackModal>` unconditionally at L4165 (dev-chord path). Shape 3's thumbs-down flow could either:
- **(A) reuse AppShell's atom** by threading a callback prop up to AppShell (matches shape 2's `onOpenFeedback` pattern — but AppShell's setter must know which eventId/exchangeText to attach when the modal fires). Requires threading `(eventId, exchangeText)` UP through PrettyView → AppShell before setting `feedbackOpen = "thumbs_down"`, then AppShell's existing `onSubmit`/`onDismiss` handlers must read those from state.
- **(B) own a second FeedbackModal at PrettyView level** with a local atom `<false | { eventId, exchangeText }>` — more self-contained, no coupling to AppShell. Planner's D-38 discretion; option (B) matches shape 2's "self-contained new caller of shape 1" ethos more cleanly since the payload context (eventId + exchangeText) is per-message and doesn't want to live in app-scope state.

**Recommendation:** option (B) — a PrettyView-scoped `feedbackModalContext` atom typed `null | { eventId: string; exchangeText: string }` and a second FeedbackModal mount. Two modal mounts is fine (Radix Dialog handles simultaneous mounts trivially; only one can be `open` at a time in practice since the user can only click one thumb at a time).

#### The shape-2 wiring pattern in `PrettyConversationsPanel` (D-38 template)
**src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx L2405-2416** — the "new caller of shape 1" pattern, showing exactly how the caller mounts the trigger, reads `useFeedbackEnabled()`, and dispatches to a callback:
```tsx
{feedbackEnabled && (
  <button
    type="button"
    className="pv-pencil"
    aria-label="Send feedback"
    title="Send feedback"
    data-testid="pv-header-send-feedback-button"
    onClick={() => onOpenFeedback?.()}
  >
    <MessageSquare size={18} />
  </button>
)}
```
Shape 3's thumbs are the SAME pattern applied per-message. `feedbackEnabled` gates whether the strip and thumbs render at all; the click handler dispatches to a callback prop (which shape 3's ChatMessage can either receive from PrettyView or, per D-39, read from `useFeedbackEnabled()` directly at the leaf).

#### Data-testid discipline (from shape 2 D-04 lock)
Shape 2 used `data-testid="pv-header-send-feedback-button"`. Shape 3 recommendation:
- Strip container: `data-testid="pv-chat-message-action-strip"`
- Thumbs-up button: `data-testid="pv-chat-message-thumbs-up"`
- Thumbs-down button: `data-testid="pv-chat-message-thumbs-down"`
- Strip-mode speak button: keep the existing `className="pv-speak-btn"` class hook (used by CSS at `src/ui/index.css:407` — see Shared Patterns below); if a testid is needed, `data-testid="pv-chat-message-speak"` matches the naming pattern.

---

### `src/ui/features/pretty-view/ChatMessage.feedback-thumbs.test.tsx` (NEW test file)

**Analog A (structure):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.send-feedback-button.test.tsx` — the shape-2 test file established the "colocated sibling test file per feature facet" convention for feedback triggers.

**Analog B (mock stack):** `src/ui/features/pretty-view/ChatMessage.speak.test.tsx` L1-77 — the ChatMessage-scope test that already mocks `voice-api` + `webAudioStreamPlayer`. Shape 3 needs the same voice mocks (since strip-mode speak still uses them) PLUS mocks for `@/feedback/feedback-store` and `@/feedback/feedback-api`.

**Mock recipe (combined):**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postFeedback } from "@/feedback/feedback-api";
import { toast } from "sonner";

// Feedback pipeline mocks (shape 3 specific)
vi.mock("@/feedback/feedback-store", () => ({
  useFeedbackEnabled: vi.fn(() => true),      // default ON — flip per-test for OFF cases
  __resetForTest: () => {},
}));
vi.mock("@/feedback/feedback-api", () => ({
  postFeedback: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

// Voice mocks (from ChatMessage.speak.test.tsx L27-52) — strip-mode speak still calls these
vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 })),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "…",
}));
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: vi.fn(async () => {}),
    stop: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  })),
}));
```

**Test file organization (D-54 planner-pick):** given the 11 D-53 test cases span both the ChatMessage internals (feedback-off render, feedback-on render, second-tap no-op, both-thumbs allowed) AND the plumbing between PrettyView and ChatMessage (exchangeText with/without prior user turn), the cleanest split is:
- **New:** `src/ui/features/pretty-view/ChatMessage.feedback-thumbs.test.tsx` — D-53 cases 1, 2, 3, 4, 5, 6, 7 (ChatMessage-internal thumbs behavior + rendering-mode gate).
- **New:** `src/ui/features/pretty-view/PrettyView.feedback-thumbs.test.tsx` — D-53 cases 8, 9, 10, 11 (exchangeText plumbing from PrettyView + verifying RelayInboundBubble/WaitingBubble/UserBubble unaffected).
- Alternative: fold cases 8-11 into `PrettyView.test.tsx` if the file's existing per-topic sections already exist. `PrettyView.autoplay.test.tsx`, `PrettyView.relay-source.test.tsx`, `PrettyView.hydration-cap.test.tsx` etc. establish the "per-feature `.tsx` suffix" convention shape 3 should follow.

**D-53 case 8-10 sanity check** (RelayInboundBubble / WaitingBubble / user-bubble unaffected when feedback is ON): render `PrettyView` with `useFeedbackEnabled = true`, feed a fixture messages array containing a `relay_inbound` frame + a `waiting` state + a `role: "user"` message, and assert:
- No `data-testid="pv-chat-message-action-strip"` for those bubble types
- No `data-testid="pv-chat-message-thumbs-up"` / `-thumbs-down` for those bubble types
- RelayInboundBubble keeps its in-bubble Volume2 speak button (its own render — verified by inspecting RelayInboundBubble.tsx L1-16 imports; unchanged in shape 3)

---

### `src/ui/features/pretty-view/ActionStrip.tsx` (OPTIONAL NEW — planner picks)

Per D-52 / Claude's Discretion: extract only if the strip has non-trivial internal logic. Inlining is simpler and stays in ChatMessage.

**If extracted, analog is the inline `<button>` at ChatMessage.tsx L603-692.** The strip would be:
```tsx
export function ActionStrip({
  speakSlot,          // <button> element for speak — ChatMessage passes its existing speak button JSX
  thumbsUpPressed,
  thumbsDownPressed,
  onThumbsUp,
  onThumbsDown,
}: {
  speakSlot: React.ReactNode;
  thumbsUpPressed: boolean;
  thumbsDownPressed: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}) {
  return (
    <div
      data-testid="pv-chat-message-action-strip"
      className="flex items-center gap-[6px] mt-[4px] pl-[4px] opacity-[0.62] hover:opacity-100 [@media(hover:none)]:opacity-[0.72]"
    >
      {speakSlot}
      {/* thumbs-up + thumbs-down — same button shell as speak, same hue tint on pressed */}
    </div>
  );
}
```
**Recommendation: inline for v1.** ChatMessage.tsx is already 696 lines; adding ~40 lines for a strip block is small; extracting adds indirection for zero code-reuse benefit (only one caller in shape 3).

---

## Shared Patterns

### Pattern S-01: `useFeedbackEnabled()` leaf-level subscription (D-39)
**Source:** `src/ui/feedback/feedback-store.ts` L94-97
**Apply to:** `ChatMessage.tsx` — reads directly at leaf per shape-1 D-08 useSyncExternalStore design.
```typescript
import { useFeedbackEnabled } from "@/feedback/feedback-store";
// Inside ChatMessage function body, near other hooks (after L120's useState / L118's useEditableFileEligibility):
const feedbackEnabled = useFeedbackEnabled();
```
Called at leaf ok because there is ONE subscriber path per bubble; useSyncExternalStore is the app's canonical pattern (no React Context in the codebase per feedback-store.ts L18-25).

### Pattern S-02: `postFeedback()` fire-and-forget invocation (D-18/D-25)
**Source:** `src/ui/feedback/feedback-api.ts` L64-83 (never-rejects contract)
**Apply to:** Every thumbs handler in ChatMessage/PrettyView.
```typescript
import { postFeedback } from "@/feedback/feedback-api";

// Thumbs-up (D-18): one-tap silent fire
void postFeedback({
  kind: "thumbs_up",
  userNote: "",
  messageRef: eventId,               // D-32
  exchangeText,                      // D-33 — computed by PrettyView, threaded via callback prop
});

// Thumbs-down (D-25): fires on BOTH modal submit AND modal dismiss
void postFeedback({
  kind: "thumbs_down",
  userNote: <typed note or "">,
  messageRef: eventId,
  exchangeText,
});
```
Never `await` — the D-27 no-re-raise contract guarantees the promise resolves even on 4xx/5xx/network fail. The `void` keyword is intentional (matches AppShell.tsx L4191).

### Pattern S-03: Post-fire toast (D-19)
**Source:** `src/ui/AppShell.tsx` L4196 + L4210 (shape 1 dev-chord path) — the exact wording and duration shape 3 must use.
**Apply to:** Every path that fires `postFeedback` (thumbs-up single-tap, thumbs-down submit, thumbs-down dismiss).
```typescript
import { toast } from "sonner";

toast.success("Thanks — feedback sent.", { duration: 2000 });
```
The `<Toaster position="bottom-right" />` is globally mounted at `src/main.tsx:243`. No additional wiring needed at ChatMessage or PrettyView.

### Pattern S-04: FeedbackModal thumbs_down variant mount (D-23/D-25)
**Source:** `src/ui/AppShell.tsx` L4165-4212 — the atom + mount + submit + dismiss quartet.
**Apply to:** PrettyView (or wherever shape 3 owns the modal). See "Recommendation: option (B)" under `PrettyView.tsx` above.
```tsx
<FeedbackModal
  open={feedbackModalContext !== null}
  variant="thumbs_down"                               // shape 3 is always thumbs_down variant
  onOpenChange={(next) => {
    if (!next) setFeedbackModalContext(null);
  }}
  onSubmit={(userNote) => {
    if (feedbackModalContext == null) return;
    void postFeedback({
      kind: "thumbs_down",
      userNote,
      messageRef: feedbackModalContext.eventId,
      exchangeText: feedbackModalContext.exchangeText,
    });
    toast.success("Thanks — feedback sent.", { duration: 2000 });
    setFeedbackModalContext(null);
  }}
  onDismissWithoutSubmit={() => {
    if (feedbackModalContext == null) return;
    void postFeedback({
      kind: "thumbs_down",
      userNote: "",                                    // D-25 empty-note contract for dismiss
      messageRef: feedbackModalContext.eventId,
      exchangeText: feedbackModalContext.exchangeText,
    });
    toast.success("Thanks — feedback sent.", { duration: 2000 });
  }}
/>
```

### Pattern S-05: In-bubble speak-button pocket + hover-lift + touch-baseline (D-07/D-08)
**Source:** `src/ui/features/pretty-view/ChatMessage.tsx` L676-680 (inline style + className)
+ `src/ui/index.css` L407-426 (the `.pv-speak-btn` size + mobile-scaled sizing)
**Apply to:** All three strip buttons (speak, thumbs-up, thumbs-down) share the same button-shell recipe.
```typescript
// Resting weight — inherited from CSS at index.css:407-415:
//   width: 28px; height: 28px; border-radius: 6px;
//   svg width/height: 16px
// Mobile (max-width: 767.98px):
//   width: 39px; height: 39px; border-radius: 8px;
//   svg width/height: 20px

// Inline-style opacity + hover-lift + touch-baseline (from ChatMessage L676-680):
style={{ opacity: 0.62, /* … */ }}
className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
```
**Recommendation:** The three strip buttons share `className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"` verbatim. Only `background`/`borderColor` differ per state (autoplay-armed on speak, pressed-state hue-fill on thumbs).

### Pattern S-06: Identity-hue pressed-state fill (D-20)
**Source:** `src/ui/features/pretty-view/ChatMessage.tsx` L667-668 (autoplay-armed hue tint on speak) — exact same recipe for thumbs pressed state per D-20 lock.
```typescript
background: autoplayArmed
  ? "hsla(var(--pv-id-hue),60%,70%,0.28)"      // ← the autoplay-armed treatment
  : "rgba(0,0,0,0.28)",
```
D-20 specifies `hsla(var(--pv-id-hue), 65%, 55%, 0.36)` from the tasting for the pressed state — same CSS variable, slightly different alpha/lightness (planner picks whether to match tasting exactly or reuse autoplay-armed's 60%/70%/0.28 for consistency). The `--pv-id-hue` variable is set on the pane (see the assistant-bubble treatment at L492-495 for other uses of the same variable).

### Pattern S-07: `pv-bubble` hover trigger (D-07 strip hover-lift)
**Source:** `src/ui/features/pretty-view/ChatMessage.tsx` L446-449 comment:
```typescript
// pv-bubble: hover-target class for descendants like
// EditableFileAffordance. Do NOT rename without updating
// [.pv-bubble:hover_&] selectors in child components.
className={cn("pv-bubble", /* … */)}
```
**Apply to:** Strip hover-lift (D-07 "hovering anywhere on the anchor lifts the strip"). The strip must be a child of a wrapper that INCLUDES `.pv-bubble` so `[.pv-bubble:hover_&]:opacity-100` selectors on the strip react to bubble hover. Since the strip lives OUTSIDE the current bubble div, the planner must either:
- (a) Wrap `bubble-div + strip-div` in a NEW outer div carrying `.pv-bubble` and move `.pv-bubble` OFF the inner bubble div; OR
- (b) Add a NEW peer-anchor class (e.g., `.pv-bubble-group`) that both the bubble div and strip react to; OR
- (c) Rely on Tailwind's group-hover: `<div className="group">` wrapping both, strip uses `group-hover:opacity-100`.

**Recommendation:** option (c) — Tailwind `group` / `group-hover` — least CSS surgery. Verified pattern in the codebase (grep the repo for existing `group-hover` usage before committing).

---

## No Analog Found

None. Every pattern shape 3 needs has a direct, verified analog in the repo:
- Feedback pipeline (postFeedback, useFeedbackEnabled, FeedbackModal, toast) — shape 1 in `src/ui/feedback/`
- "New caller of shape 1" wiring (atom + gate + payload build + toast) — shape 2 in `src/ui/AppShell.tsx` L357/L4165-4212 + `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L2405-2416
- ChatMessage speak-button structure, glyph state machine, hover-lift, touch baseline — self, `ChatMessage.tsx` L603-692
- ChatMessage assistant-bubble class-swap + identity-hue tint — self, `ChatMessage.tsx` L448-498
- Colocated feature-facet test file with feedback + voice mocks — combining `PrettyConversationsPanel.send-feedback-button.test.tsx` (shape 2) + `ChatMessage.speak.test.tsx` (voice mocks)
- Callback-prop threading from container to leaf — `PrettyConversationsPanel.tsx` L428 (`onOpenFeedback`) + `PrettyView.tsx` L3951-3970 (ChatMessage prop threading)

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (ChatMessage.tsx, PrettyView.tsx, RelayInboundBubble.tsx, WaitingBubble.tsx, plus test siblings)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (shape 2 wiring)
- `src/ui/AppShell.tsx` (feedbackOpen atom, FeedbackModal mount, toast fire)
- `src/ui/feedback/` (feedback-store, feedback-api, FeedbackModal — READ-ONLY reference)
- `src/ui/index.css` (`.pv-speak-btn` sizing)
- `src/main.tsx` (Toaster mount)

**Files scanned:** ~15 (all in-scope for shape-3 pattern extraction)
**Files with concrete excerpts extracted:** 8
**Pattern extraction date:** 2026-09-20
