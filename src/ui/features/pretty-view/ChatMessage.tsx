import React, { useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, Volume2, Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { preprocessCommandTriplets, splitMarkers } from "./commandTags";
import { parseInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { AttachmentChipStrip } from "./AttachmentChipStrip";
import { CopyableBlock } from "./CopyableBlock";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer, type WebAudioStreamPlayer } from "./webAudioStreamPlayer";

// Patch #237 (Phase 19): singleton now tracks a WebAudioStreamPlayer instance.
// The player encapsulates the AudioContext, scheduled AudioBufferSourceNodes,
// and the fetch reader loop. See ./webAudioStreamPlayer.ts.
// Cross-bubble Stop / new-bubble-preempt semantics preserved: starting on
// bubble A while bubble B plays stops B first; clicking Stop on the playing
// bubble stops it; unmount cleanup stops if this bubble owns the singleton.
let currentPlayer: WebAudioStreamPlayer | null = null;
let currentOwner: symbol | null = null;

// Presentational chat bubble for one conversational message.
//
// Content is rendered as markdown (GFM) via react-markdown so **bold**,
// backticks, bullet lists, tables, etc. render as formatted output
// rather than literal characters — Claude Code's assistant output is
// mostly markdown, and Ashley writes markdown-flavored prose too. Raw
// HTML in the source is NOT interpreted (react-markdown default) so
// there is no XSS surface even for untrusted content.
//
// Prose styling comes from @tailwindcss/typography via `prose prose-sm`.
// The `max-w-none` override lets the bubble's own width cap the block;
// the first/last-child margin resets keep the tight bubble aesthetic
// (typography defaults would leave a stripe of whitespace at top/bottom
// of every message). User bubbles use `prose-invert` unconditionally
// (primary bg is dark in every theme); assistant bubbles use
// `dark:prose-invert` so headings/code/strong/em get light-mode prose
// colors on the light theme card and dark-mode prose colors (light
// grays) on the dark theme card. Without the assistant-side invert,
// Skynet's dark card renders headings/inline-code in default light-mode
// prose colors — dark grays that read as "faint/unreadable" against
// the dark card background.
//
// Font: Skynet sets `font-mono` (JetBrains Mono) globally for the
// terminal aesthetic. Pretty view is a prose surface, so we override
// with Inter — the modern default for chat/UI text at small sizes,
// tuned for screen legibility. Inline `code` bubbles opt back into
// mono via the prose-code override in index.css so command names and
// paths still read as code.
export function ChatMessage({
  role,
  content,
  identityVoice = null,
  ts,
  eventId,
  autoplayArmed = false,
  autoplayTargetEventId = null,
  onLongPressSpeak,
}: {
  role: "user" | "assistant";
  content: string;
  identityVoice?: string | null;
  ts?: number;
  eventId?: string;
  autoplayArmed?: boolean;
  autoplayTargetEventId?: string | null;
  onLongPressSpeak?: (eventId: string) => void;
}) {
  const isUser = role === "user";
  const bubbleIdRef = useRef(Symbol("speak-bubble"));
  const [speakState, setSpeakState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  // Long-press detection refs
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef<boolean>(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Autoplay dedup ref — stores the last eventId we already fired autoplay for,
  // preventing double-fire if React re-renders while the effect is settling.
  const autoplayLastFiredRef = useRef<string | null>(null);

  // Cleanup: stop player on unmount if this bubble owns it; also clear any
  // pending long-press timer.
  useEffect(() => {
    return () => {
      if (currentOwner === bubbleIdRef.current) {
        currentPlayer?.stop();
        currentPlayer = null;
        currentOwner = null;
      }
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  // startSpeak: extracted fresh-play path (cross-bubble preempt + loading +
  // fetch + play). Called by:
  //   - onSpeakClick (fresh-play branch)
  //   - long-press handler (single-gesture-single-action)
  //   - autoplay effect (newly-arrived assistant message while armed)
  async function startSpeak() {
    // If another bubble is playing (or loading, or paused), stop it first
    // (cross-bubble preempt). This is also the only cancel-from-paused path.
    if (currentPlayer) {
      currentPlayer.stop();
      currentPlayer = null;
      currentOwner = null;
    }

    setSpeakState("loading");
    const owner = bubbleIdRef.current;

    const player = createWebAudioStreamPlayer({
      onEnded: () => {
        // Only clear if this bubble still owns the singleton — guard against
        // a race where a NEW speak-click already replaced the singleton
        // (setSpeakState on the OLD bubble would flash "idle" briefly and
        // race the new bubble's "loading" render).
        if (currentOwner === owner) {
          currentPlayer = null;
          currentOwner = null;
          setSpeakState("idle");
        }
      },
      onError: (err) => {
        // Patch #237: accepted tradeoff per 19-CONTEXT.md § Error handling —
        // no auto-toast on streaming errors. Log for observability; UI
        // recovers by returning to idle so the user can retry.
        console.error("[postSpeakStream] player error:", err);
        if (currentOwner === owner) {
          currentPlayer = null;
          currentOwner = null;
          setSpeakState("idle");
        }
      },
    });

    // Install the singleton BEFORE the fetch so a same-tick preempt from
    // another bubble sees a non-null currentPlayer and can stop us cleanly.
    currentPlayer = player;
    currentOwner = owner;

    try {
      const text = containerRef.current?.innerText ?? content;
      const response = await postSpeakStream(text, identityVoice ?? undefined);
      // Race check: if another bubble preempted us during the fetch,
      // currentOwner has changed. Bail out before scheduling any audio.
      if (currentOwner !== owner) return;
      if (!response.ok) throw new Error(`postSpeakStream returned ${response.status}`);
      setSpeakState("playing");
      // Fire-and-forget: play() drives its own read loop; we hear back via callbacks.
      void player.play(response);
    } catch (err) {
      console.error("[postSpeakStream] fetch error:", err);
      if (currentOwner === owner) {
        currentPlayer = null;
        currentOwner = null;
        setSpeakState("idle");
      }
    }
  }

  async function onSpeakClick(e: React.MouseEvent) {
    e.stopPropagation();

    // Same-bubble click while playing: pause. AudioContext.suspend() freezes
    // the context clock — already-scheduled sources and any that arrive from
    // the read loop during the pause naturally queue up until resume.
    if (speakState === "playing" && currentOwner === bubbleIdRef.current) {
      void currentPlayer?.pause();
      setSpeakState("paused");
      return;
    }

    // Same-bubble click while paused: resume. If the browser killed the
    // AudioContext under us (long background suspension), the player fires
    // onError → the handler below flips speakState back to idle.
    if (speakState === "paused" && currentOwner === bubbleIdRef.current) {
      void currentPlayer?.resume();
      setSpeakState("playing");
      return;
    }

    // Fresh-play path — delegated to startSpeak().
    void startSpeak();
  }

  // Autoplay effect: fires startSpeak() when a new target arrives that matches
  // this bubble's eventId. Uses autoplayLastFiredRef to prevent double-fire on
  // re-renders while the effect is settling.
  useEffect(() => {
    if (
      !isUser &&
      autoplayTargetEventId != null &&
      eventId != null &&
      autoplayTargetEventId === eventId &&
      autoplayLastFiredRef.current !== eventId
    ) {
      autoplayLastFiredRef.current = eventId;
      void startSpeak();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayTargetEventId, eventId, isUser]);

  // Phase 05 Plan 03: sender-side chip render for injected user turns.
  // When a user-role message's content matches the exact format produced
  // by formatInjectedUserTurn (caption + \n\n + INJECTED_DELIMITER + \n +
  // per-file `N. name (size, mime) → path` + `   uploaded ts` pairs), the
  // bubble renders as caption text + inline chip strip in the SAME wrapper
  // instead of the normal markdown render. Non-matching content falls
  // through to the normal path — the parser returns null quickly for the
  // vast majority of messages (early indexOf bail on the delimiter
  // substring), so there is no perf concern for non-injected messages.
  // Assistant messages never trigger the parser (role gate — defense in
  // depth against an assistant reply that coincidentally quotes the
  // delimiter substring in prose).
  const injected = isUser ? parseInjectedUserTurn(content) : null;
  // Quick-reply as-a-thumbs-up: a user message whose text is exactly the
  // quick-reply payload "let's go" (case-insensitive, ignoring surrounding
  // whitespace) renders as a ThumbsUp glyph inside the normal user bubble.
  // Mirrors the ComposeBox quick-send button that produces this message, so
  // what she sent visually matches what she clicked. Client-render-only —
  // session file stays faithful. Single equality check: legacy alt-matches
  // for 'yes'/'works for me'/'good to go'/'go ahead'/'thumbs up' render as
  // plain text.
  const isQuickReply =
    isUser && !injected && content.trim().toLowerCase() === "let's go";
  // Prettify slash-command triplets before markdown parsing. Runs of
  // <command-message>/<command-name>/<command-args> tags become ⟨cmd:...⟩
  // sentinel markers, then the `p` component override below splits those
  // markers out into <CommandChip> pills. Backend session-file-parser stays
  // faithful to the wire format — this transform is client-render-only.
  const processedContent = preprocessCommandTriplets(content);
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        ref={containerRef}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={{ position: "relative" }}
        className={cn(
          // Phase 4 Glass: raised-object bubble treatment.
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          isUser ? "px-[18px] py-[14px]" : "pl-[18px] pr-[42px] pt-[14px] pb-0",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          // Prose scaffolding (typography plugin).
          "prose prose-sm max-w-[85%]",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          // Preformatted code blocks: Glass depth (inner shadow + hairline border).
          "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
          "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]",
          "prose-pre:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]",
          // Inline code: warm coral foreground + subtle chip rectangle.
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
          "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]",
          "prose-code:border prose-code:border-white/[0.06]",
          isUser
            ? cn(
                // User bubble = mock's original assistant treatment
                // (translucent mid-blue-gray gradient over the depth). Ashley
                // is always Ashley, no per-pane variation. Reads as the
                // stable "not-the-agent" side; assistant bubbles pop against
                // it with their identity hue.
                "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
                "text-[#dfe3ee]",
                "border-[rgba(120,140,180,0.2)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
                "dark:prose-invert",
              )
            : cn(
                // Assistant carries the identity-hue tint — "the identity is
                // the one speaking these bubbles" semantic. More saturated
                // than the first pass (28% → 50% sat) per Ashley's "colors
                // should be more vibrant" round. Rich hue border + hue outer
                // glow at ~15-20% alpha.
                "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]",
                "text-[#fbf5e8]",
                "border-[hsla(var(--pv-id-hue),65%,55%,0.32)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]",
                "prose-invert",
              ),
        )}
      >
        {isQuickReply ? (
          <ThumbsUp className="size-6" aria-label="quick reply" />
        ) : injected ? (
          // Phase 05 Plan 03 (UPLOAD-11): sender-side render of an injected
          // user turn. Caption text sits above an inline chip strip inside
          // the SAME bubble. Chips are filename + human-size only — no
          // thumbnails, no inline previews even for images, no landing-path
          // display (HARD LOCK from CONTEXT.md § Sender-side rendering).
          // AttachmentChipStrip runs in readOnly mode: no × remove, no
          // progress ring, no error decorations.
          <>
            {injected.caption.length > 0 && (
              <div className="pv-injected-caption whitespace-pre-wrap mb-2">
                {injected.caption}
              </div>
            )}
            <AttachmentChipStrip
              attachments={injected.files.map((f) => ({
                // tempId is unique per-file inside this bubble; landingPath
                // is guaranteed unique by the backend's collision-suffix loop
                // (Plan 01 orchestrator) so it doubles as a stable key.
                tempId: f.landingPath,
                file: { name: f.filename, size: f.size, type: f.mimetype },
                status: "complete",
                bytesUploaded: f.size,
                error: null,
              }))}
              onRemove={() => {
                /* readOnly — never fires */
              }}
              readOnly={true}
            />
          </>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node, ...props }) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ),
              p: ({ node, children, ...props }) => (
                <p {...props}>{splitMarkers(children)}</p>
              ),
              pre: ({ node, children, ...props }) => (
                <CopyableBlock as="pre" {...props}>{children}</CopyableBlock>
              ),
              blockquote: ({ node, children, ...props }) => (
                <CopyableBlock as="blockquote" {...props}>{children}</CopyableBlock>
              ),
            }}
          >
            {processedContent}
          </ReactMarkdown>
        )}
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
                void startSpeak();
              }, 500);
            }}
            onPointerMove={(e) => {
              const start = pointerStartRef.current;
              if (!start || longPressTimerRef.current == null) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.hypot(dx, dy) > 10) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onPointerCancel={() => {
              if (longPressTimerRef.current != null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onPointerUp={() => {
              // Clear the pending timer if it hasn't fired yet — this is a tap.
              // Do NOT clear longPressFiredRef here — the subsequent onClick
              // needs to read it.
              if (longPressTimerRef.current != null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onClick={(e) => {
              // Suppress the tap-driven click if a long-press already fired.
              if (longPressFiredRef.current) {
                longPressFiredRef.current = false;
                e.stopPropagation();
                return;
              }
              void onSpeakClick(e);
            }}
            aria-label={
              speakState === "playing"
                ? "Pause speaking"
                : speakState === "paused"
                  ? "Resume speaking"
                  : "Speak message"
            }
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: autoplayArmed
                ? "hsla(var(--pv-id-hue),60%,70%,0.28)"
                : "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: autoplayArmed
                ? "hsla(var(--pv-id-hue),70%,70%,0.35)"
                : "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              opacity: 0.62,
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
          >
            {speakState === "loading" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : speakState === "playing" ? (
              <Pause size={16} />
            ) : speakState === "paused" ? (
              <Play size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
