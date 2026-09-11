import React, { useRef, useState, useEffect, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, Volume2, Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { preprocessCommandTriplets, splitMarkers } from "./commandTags";
import { parseInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { AttachmentChipStrip } from "./AttachmentChipStrip";
import { CopyableBlock } from "./CopyableBlock";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";
import { EditableFileAffordance } from "./EditableFileAffordance";
import {
  getCurrentPlayer,
  setCurrentPlayer,
  getCurrentOwner,
  setCurrentOwner,
  clearCurrentPlayer,
} from "./speak-singleton";

// Patch #237 (Phase 19): singleton now tracks a WebAudioStreamPlayer instance.
// The player encapsulates the AudioContext, scheduled AudioBufferSourceNodes,
// and the fetch reader loop. See ./webAudioStreamPlayer.ts.
// Cross-bubble Stop / new-bubble-preempt semantics preserved: starting on
// bubble A while bubble B plays stops B first; clicking Stop on the playing
// bubble stops it; unmount cleanup stops if this bubble owns the singleton.
//
// Phase 97 UAT batch #6 (2026-09-10): the singleton pair now lives in
// ./speak-singleton.ts so RelayInboundBubble can share the SAME pair —
// tapping speak on either component preempts the other. Access via the
// getCurrentPlayer / setCurrentPlayer / getCurrentOwner / setCurrentOwner /
// clearCurrentPlayer helpers imported above.

// Presentational chat bubble for one conversational message.
//
// Content is rendered as markdown (GFM) via react-markdown so **bold**,
// backticks, bullet lists, tables, etc. render as formatted output
// rather than literal characters — Claude Code's assistant output is
// mostly markdown, and Alice writes markdown-flavored prose too. Raw
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
  onOpenEditor,
  pendingState = null,
  attachments,
}: {
  role: "user" | "assistant";
  content: string;
  identityVoice?: string | null;
  ts?: number;
  eventId?: string;
  autoplayArmed?: boolean;
  autoplayTargetEventId?: string | null;
  onLongPressSpeak?: (eventId: string) => void;
  // Phase 40 D-03/D-06: opens the EditableFileModal for a specific tailnet
  // URL. Optional so callers that don't provide it (tests, historical mount
  // sites) safely skip the affordance render.
  onOpenEditor?: (input: {
    messageEventId: string;
    url: string;
    filename: string;
  }) => void;
  // Phase 50 D-01/D-03/D-06/D-19: optimistic-send bubble state. Only
  // meaningful for user bubbles (assistant bubbles ignore it — pending
  // state is a send-path concept). 'sending' renders a small trailing-edge
  // Loader2 spinner; 'failed' applies a muted-red border/tint via
  // data-pv-bubble-failed. null | undefined = no rendering change
  // (back-compat with every existing mount site).
  pendingState?: "sending" | "failed" | null;
  // Phase 80 D-15: attachments carried on a pending-with-attachments seed
  // (PendingSend.attachments — populated by Plan 02's onUploadReadyToInject
  // wiring). When present + non-empty AND the existing `injected` branch
  // condition is false, the new pending-with-attachments render branch
  // fires: caption above AttachmentChipStrip in readOnly mode (mirrors the
  // settled `injected` bubble shape but sources data from this prop rather
  // than parseInjectedUserTurn(content)). Absent for text-only pending
  // bubbles and for settled bubbles (backward-compat with every existing
  // mount site).
  attachments?: Array<{
    filename: string;
    size: number;
    mimetype: string;
  }>;
}) {
  const isUser = role === "user";
  // D-01: hook fires for both roles; user messages never carry tailnet URLs
  // so the Set stays empty. Simpler than a conditional hook (Rules of Hooks).
  const eligibleUrls = useEditableFileEligibility(eventId ?? null, content);
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
      if (getCurrentOwner() === bubbleIdRef.current) {
        const owner = bubbleIdRef.current;
        console.info(`[tts] stop-current owner=${owner.toString()} trigger=unmount`);
        getCurrentPlayer()?.stop();
        clearCurrentPlayer();
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
  async function startSpeak(trigger: "user-click" | "autoplay" | "long-press" = "user-click") {
    // If another bubble is playing (or loading, or paused), stop it first
    // (cross-bubble preempt). This is also the only cancel-from-paused path.
    const preemptTarget = getCurrentPlayer();
    if (preemptTarget) {
      const prevOwner = getCurrentOwner();
      console.info(`[tts] stop-current owner=${prevOwner?.toString() ?? "null"} trigger=new-bubble`);
      preemptTarget.stop();
      clearCurrentPlayer();
    }

    setSpeakState("loading");
    const owner = bubbleIdRef.current;

    // Speak-start — entry log for every TTS invocation.
    const text = containerRef.current?.innerText ?? content;
    console.info(`[tts] speak-start owner=${owner.toString()} textLen=${text.length} voice="${identityVoice ?? "default"}" trigger=${trigger}`);

    const player = createWebAudioStreamPlayer({
      onEnded: () => {
        // Only clear if this bubble still owns the singleton — guard against
        // a race where a NEW speak-click already replaced the singleton
        // (setSpeakState on the OLD bubble would flash "idle" briefly and
        // race the new bubble's "loading" render).
        if (getCurrentOwner() === owner) {
          console.info(`[tts] media-ended owner=${owner.toString()}`);
          clearCurrentPlayer();
          setSpeakState("idle");
        }
      },
      onError: (err) => {
        // Patch #237: accepted tradeoff per 19-CONTEXT.md § Error handling —
        // no auto-toast on streaming errors. Log for observability; UI
        // recovers by returning to idle so the user can retry.
        // D-05: extract err fields explicitly — never JSON.stringify(event).
        const errName = err instanceof Error ? err.name : "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`[tts] player-error owner=${owner.toString()} errName="${errName}" errMessage="${errMessage}"`);
        if (getCurrentOwner() === owner) {
          clearCurrentPlayer();
          setSpeakState("idle");
        }
      },
      onPlaying: () => {
        console.info(`[tts] media-playing owner=${owner.toString()}`);
      },
      onCanPlay: () => {
        console.info(`[tts] media-canplay owner=${owner.toString()}`);
      },
      onPause: () => {
        console.info(`[tts] media-pause owner=${owner.toString()}`);
      },
      onStalled: () => {
        console.warn(`[tts] media-stalled owner=${owner.toString()}`);
      },
      onSuspend: () => {
        console.warn(`[tts] media-suspend owner=${owner.toString()}`);
      },
    });

    // Install the singleton BEFORE the fetch so a same-tick preempt from
    // another bubble sees a non-null currentPlayer and can stop us cleanly.
    setCurrentPlayer(player);
    setCurrentOwner(owner);

    try {
      // Fetch stage — D-02 instrumentation.
      console.info(`[tts] fetch-start owner=${owner.toString()} url=/voice/speak-stream textLen=${text.length}`);
      const response = await postSpeakStream(text, identityVoice ?? undefined);
      // Race check: if another bubble preempted us during the fetch,
      // currentOwner has changed. Bail out before scheduling any audio.
      if (getCurrentOwner() !== owner) {
        console.warn(`[tts] preempt-during-fetch owner=${owner.toString()} newOwner=${getCurrentOwner()?.toString() ?? "null"}`);
        return;
      }
      console.info(`[tts] fetch-resolved status=${response.status} ok=${response.ok} owner=${owner.toString()}`);
      if (!response.ok) {
        console.error(`[tts] fetch-error owner=${owner.toString()} status=${response.status} statusText="${response.statusText}"`);
        throw new Error(`postSpeakStream returned ${response.status}`);
      }
      setSpeakState("playing");
      // Decode/audio-context init — the WebAudioStreamPlayer creates an AudioContext
      // internally on play(). Log the play-attempt before delegating.
      console.info(`[tts] decode-init owner=${owner.toString()} contextState=n/a`);
      // play-attempt: fire before delegating to player.play() which drives the read loop.
      console.info(`[tts] play-attempt owner=${owner.toString()} src=stream`);
      // Fire-and-forget: play() drives its own read loop; we hear back via callbacks.
      void player.play(response).then(() => {
        console.info(`[tts] play-attempt owner=${owner.toString()} result=success`);
      }).catch((err: unknown) => {
        // Extract name/message from both Error and non-Error throwables.
        // DOMException does not extend Error in all environments (JSDOM, older
        // Safari) — check for a .name property on any object before falling
        // back to "unknown". This ensures NotAllowedError detection is robust.
        const errName =
          err instanceof Error
            ? err.name
            : (err != null && typeof (err as Record<string, unknown>).name === "string"
                ? (err as { name: string }).name
                : "unknown");
        const errMessage =
          err instanceof Error
            ? err.message
            : (err != null && typeof (err as Record<string, unknown>).message === "string"
                ? (err as { message: string }).message
                : String(err));
        if (errName === "NotAllowedError") {
          console.warn(`[tts] play-attempt owner=${owner.toString()} result=blocked errName="NotAllowedError" errMessage="${errMessage}"`);
        } else {
          console.error(`[tts] play-attempt owner=${owner.toString()} result=error errName="${errName}" errMessage="${errMessage}"`);
        }
      });
    } catch (err) {
      const errName = err instanceof Error ? err.name : "unknown";
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[tts] fetch-error owner=${owner.toString()} errName="${errName}" errMessage="${errMessage}"`);
      if (getCurrentOwner() === owner) {
        clearCurrentPlayer();
        setSpeakState("idle");
      }
    }
  }

  async function onSpeakClick(e: React.MouseEvent) {
    e.stopPropagation();

    // Same-bubble click while playing: pause. AudioContext.suspend() freezes
    // the context clock — already-scheduled sources and any that arrive from
    // the read loop during the pause naturally queue up until resume.
    if (speakState === "playing" && getCurrentOwner() === bubbleIdRef.current) {
      void getCurrentPlayer()?.pause();
      setSpeakState("paused");
      return;
    }

    // Same-bubble click while paused: resume. If the browser killed the
    // AudioContext under us (long background suspension), the player fires
    // onError → the handler below flips speakState back to idle.
    if (speakState === "paused" && getCurrentOwner() === bubbleIdRef.current) {
      void getCurrentPlayer()?.resume();
      setSpeakState("playing");
      return;
    }

    // Fresh-play path — delegated to startSpeak().
    void startSpeak("user-click");
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
      console.info(`[tts] autoplay-fired eventId=${eventId} armed=${autoplayTargetEventId != null}`);
      void startSpeak("autoplay");
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
  // quick-reply payload "thumbs up" (case-insensitive, ignoring surrounding
  // whitespace) renders as a ThumbsUp glyph inside the normal user bubble.
  // Mirrors the ComposeBox quick-send button that produces this message, so
  // what she sent visually matches what she clicked. Client-render-only —
  // session file stays faithful. Single equality check: legacy alt-matches
  // for 'yes'/'works for me'/'good to go'/'go ahead'/'let's go' render as
  // plain text.
  const isQuickReply =
    isUser && !injected && content.trim().toLowerCase() === "thumbs up";
  // Prettify slash-command triplets before markdown parsing. Runs of
  // <command-message>/<command-name>/<command-args> tags become ⟨cmd:...⟩
  // sentinel markers, then the `p` component override below splits those
  // markers out into <CommandChip> pills. Backend session-file-parser stays
  // faithful to the wire format — this transform is client-render-only.
  const processedContent = preprocessCommandTriplets(content);
  // BUG C1 fix: memoize the ReactMarkdown `components` object. Passing a fresh
  // inline object literal every render forced ReactMarkdown to remount its
  // child overrides — including <EditableFileAffordance>, which then re-fired
  // useIsTouchDevice's initial-render flash on every parent re-render. Deps
  // are exactly the values the `a` override closes over: eventId, onOpenEditor,
  // eligibleUrls. The p/pre/blockquote overrides only close over module-scope
  // imports (splitMarkers, CopyableBlock) — stable, not deps.
  const markdownComponents = useMemo<Components>(() => ({
    // D-03: affordance renders as fragment sibling — anchor semantics
    // (target/rel/click) preserved verbatim per LOCKED additive-not-
    // replacive.
    a: ({ node: _node, ...rest }) => {
      const props = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
      const href = props.href;
      // Compute affordance eligibility (Pitfall 1: href destructured
      // from props, NOT from `node`).
      let filename = "";
      let isEligible = false;
      if (href && eventId && onOpenEditor) {
        try {
          const parsed = new URL(href);
          // Pitfall 8: URL.pathname strips ?query before we split.
          filename = decodeURIComponent(
            parsed.pathname.split("/").pop() ?? "",
          );
          isEligible = eligibleUrls.has(href);
        } catch {
          // Invalid URL — not a tailnet pattern anyway.
          isEligible = false;
        }
      }
      return (
        <>
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
          />
          {isEligible ? (
            <EditableFileAffordance
              filename={filename}
              onOpen={() =>
                onOpenEditor!({
                  messageEventId: eventId!,
                  url: href!,
                  filename,
                })
              }
            />
          ) : null}
        </>
      );
    },
    p: ({ node, children, ...props }) => (
      <p {...props}>{splitMarkers(children)}</p>
    ),
    pre: ({ node, children, ...props }) => (
      <CopyableBlock as="pre" {...props}>{children}</CopyableBlock>
    ),
    blockquote: ({ node, children, ...props }) => (
      <CopyableBlock as="blockquote" {...props}>{children}</CopyableBlock>
    ),
  }), [eventId, onOpenEditor, eligibleUrls]);
  // Phase 50 Plan 03 Task 1 (D-01/D-03/D-06/D-19): user-only pending-state
  // gate. Assistant bubbles ignore the prop; failed supersedes sending
  // (mutually exclusive per Test 6).
  //
  // Phase 76 Plan 02 — D-06 semantic upgrade (Alice 2026-09-06 verbatim:
  // "hopefully after we do this work a failed bubble will be a truly failed
  // bubble and that is worth being that loud about"). Post-Phase-76, a failed
  // bubble means the backend spent its FULL 210s give-up ceiling and actually
  // gave up — it is a rare, truly-failed event. The visual must carry that
  // weight: whole-bubble red fill, not just a red border + faint tint.
  //
  // CSS approach: use the `background` SHORTHAND (not `backgroundColor`) in
  // the inline style. `background` overrides `background-image` (which is what
  // the Tailwind `bg-[linear-gradient(...)]` utility class at line 451 sets),
  // while `backgroundColor` alone would lose to the gradient in the cascade.
  // Inline-style specificity beats any className utility, so the saturated-red
  // `background` replaces the base blue-gray gradient entirely.
  const showSendingSpinner = isUser && pendingState === "sending";
  const showFailedBubble = isUser && pendingState === "failed";
  const bubbleInlineStyle: React.CSSProperties = showFailedBubble
    ? {
        position: "relative",
        background: "hsla(0, 60%, 35%, 0.90)",
        borderColor: "hsla(0, 70%, 50%, 0.85)",
      }
    : { position: "relative" };
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        ref={containerRef}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={bubbleInlineStyle}
        {...(showFailedBubble ? { "data-pv-bubble-failed": "true" } : {})}
        // pv-bubble: hover-target class for descendants like
        // EditableFileAffordance. Do NOT rename without updating
        // [.pv-bubble:hover_&] selectors in child components.
        className={cn(
          "pv-bubble",
          // Phase 4 Glass: raised-object bubble treatment.
          "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          isUser ? "px-[12px] py-[7px]" : "pl-[12px] pr-[42px] py-[7px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          // Prose scaffolding (typography plugin).
          "prose prose-sm max-w-[90%]",
          "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>*:has(+.pv-speak-btn)]:mb-0",
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
                // (translucent mid-blue-gray gradient over the depth). Alice
                // is always Alice, no per-pane variation. Reads as the
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
                // than the first pass (28% → 50% sat) per Alice's "colors
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
        ) : attachments && attachments.length > 0 ? (
          // Phase 80 D-15: pending-with-attachments render. Fires when the
          // pending seed carried attachments (from PrettyView's
          // onUploadReadyToInject closure, Plan 02). Sources from the
          // `attachments` prop directly — no parseInjectedUserTurn call
          // because the pending record's `content` field carries only the
          // caption. See RESEARCH.md § Pattern 3 for shape rationale.
          //
          // Placed AFTER the `injected` branch so a settled attachment
          // bubble whose content parses cleanly always wins ordering
          // (defense-in-depth against the pending record hanging around
          // once the harness echoes and the FIFO head-match cleanup fires
          // — the settled render should take over).
          //
          // Whole-bubble red on failure (Phase 76 D-06) is inherited for
          // free via bubbleInlineStyle at the outer bubble div (L420) —
          // no additional style work needed for pendingState === "failed".
          //
          // Duplicated inline (not extracted to a helper) per RESEARCH.md
          // § "Share vs Duplicate": different caption source (content vs
          // injected.caption), different tempId source (synthetic vs
          // landingPath), different file-shape mapping (PendingSend
          // triple vs ParsedInjectedTurn files), 8 lines of JSX total.
          <>
            {content.length > 0 && (
              <div className="pv-injected-caption whitespace-pre-wrap mb-2">
                {content}
              </div>
            )}
            <AttachmentChipStrip
              attachments={attachments.map((f, idx) => ({
                // Synthetic tempId — pending records have no landingPath;
                // used only as React key inside the short-lived pending
                // bubble. Index-based (not filename+size) so two identically-
                // named identically-sized files in the same batch keep unique
                // React keys (code-review M1, 2026-09-07).
                tempId: `pending-${idx}`,
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
            components={markdownComponents}
          >
            {processedContent}
          </ReactMarkdown>
        )}
        {showSendingSpinner && (
          // Phase 50 D-01/D-06: small trailing-edge Loader2 spinner. Sits
          // INSIDE the bubble root at the trailing edge (after content) so
          // it visually reads as "attached to the message". Mutually
          // exclusive with the failed state (Test 6) — gate at declaration
          // (showFailedBubble ? no spinner : maybe spinner) ensures no
          // failed bubble ever renders the spinner even for a same-tick
          // 'sending'→'failed' transition.
          <Loader2
            aria-hidden
            data-pv-bubble-spinner
            className="ml-1 inline-block h-3 w-3 animate-spin opacity-70"
          />
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
                void startSpeak("long-press");
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
