import React, { useRef, useState, useEffect, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ThumbsUp, ThumbsDown, Volume2, Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
// Phase 124 Plan 01 (D-39): leaf-level subscription to the feedback-enabled
// signal per Pattern S-01. Gates BOTH the layout swap (in-bubble speak button
// → strip below the bubble) AND the thumbs affordance render — they travel
// together per D-01. useSyncExternalStore-based; O(1) subscribe.
import { useFeedbackEnabled } from "@/feedback/feedback-store";
import { preprocessCommandTriplets, splitMarkers } from "./commandTags";
import { parseInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { AttachmentChipStrip } from "./AttachmentChipStrip";
import { CopyableBlock } from "./CopyableBlock";
import { postSpeakStream } from "@/api/voice-api";
import { notifySpeakFailed, speakErrorStatus } from "./speak-errors";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";
import { FileChip } from "./FileChip";
import { WidgetBubble } from "./WidgetBubble";

// Returns true iff `href` is a Skynet-served file URL on THIS same origin.
// Anchoring to `window.location.origin` closes an assistant-plants-tracking-
// -pixel attack: an untrusted markdown link like
// `https://attacker.tld/file/x/tracker.png` would otherwise render as a
// FileChip whose <img src> fires a cookie-bearing request to attacker.tld,
// leaking the user's presence. Same-origin URLs go through Skynet's own
// backend, which already enforces host permissions.
function isSkynetFileUrl(href: string | undefined): boolean {
  if (!href) return false;
  if (typeof window === "undefined") return false;
  const prefix = `${window.location.origin}/file/`;
  return href.startsWith(prefix);
}

/**
 * Build a Skynet file URL from a host name and an absolute landing path.
 * Encodes each path segment defensively so filenames with spaces, unicode,
 * or reserved URL characters (`?` `#` `%` `&`) survive without injecting
 * query / fragment syntax into the URL. The `/` separator is preserved.
 */
function buildSkynetFileUrl(hostName: string, landingPath: string): string {
  const encodedHost = encodeURIComponent(hostName);
  const encodedPath = landingPath
    .split("/")
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `${window.location.origin}/file/${encodedHost}/${encodedPath}`;
}
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
// mostly markdown, and user writes markdown-flavored prose too. Raw
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
// Font: inherits the app-wide Inter default (index.css). Inline `code`
// bubbles opt into mono via the prose-code override in index.css so
// command names and paths still read as code.
const NO_VOICES: readonly string[] = [];

export function ChatMessage({
  role,
  content,
  speakVoices = NO_VOICES,
  ts,
  eventId,
  onThumbsUp,
  onThumbsDown,
  onOpenEditor,
  onWidgetSubmit,
  pendingState = null,
  attachments,
  hostName,
}: {
  role: "user" | "assistant";
  content: string;
  /** Voice candidates in preference order (voice-candidates.ts); [] = provider default. */
  speakVoices?: readonly string[];
  ts?: number;
  eventId?: string;
  // Phase 124 Plan 01 D-38: leaf-level callbacks the assistant-bubble strip
  // fires on thumbs-up / thumbs-down tap. Payload is the message's eventId
  // (used as `messageRef` per D-32). Both optional — a ChatMessage without
  // handlers still renders the strip when feedbackEnabled (Plan 02 wires the
  // handlers at PrettyView; ChatMessage-scope tests exercise the callback
  // dispatch without a real postFeedback fire). Note: the modal-open logic
  // for thumbs-down (D-23) lives in Plan 02's PrettyView handler; this
  // callback runs BEFORE any modal opens (D-26 — pressed state applies
  // immediately on tap).
  onThumbsUp?: (eventId: string) => void;
  onThumbsDown?: (eventId: string) => void;
  // Phase 40 D-03/D-06: opens the EditableFileModal for a specific tailnet
  // URL. Optional so callers that don't provide it (tests, historical mount
  // sites) safely skip the affordance render.
  onOpenEditor?: (input: {
    messageEventId: string;
    url: string;
    filename: string;
  }) => void;
  // Phase 137 D-137: parent's widget-submit dispatcher — WidgetBubble invokes
  // this when the iframe postMessages a widget-submit signal. Optional so
  // tests + historical mount sites without widget-submit plumbing still work.
  onWidgetSubmit?: (widgetId: string, value: string) => void;
  // Phase 50 D-01/D-03/D-06/D-19: optimistic-send bubble state. Only
  // meaningful for user bubbles (assistant bubbles ignore it — pending
  // state is a send-path concept). 'sending' renders a small trailing-edge
  // Loader2 spinner; 'failed' applies a muted-red border/tint via
  // data-pv-bubble-failed. null | undefined = no rendering change
  // (back-compat with every existing mount site).
  pendingState?: "sending" | "failed" | null;
  // Shape (2026-09-28): string hostname of the target host, used to build
  // Skynet /file/<host>/<abs-path> URLs for the injected user-turn's file
  // entries. Threaded from IdentitySessionPane → PrettyView → here. When
  // present, injected-turn file entries render as interactive FileChips
  // (same click contract as assistant-side chips); when absent, they fall
  // back to the static read-only AttachmentChipStrip render.
  hostName?: string;
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

  // Phase 124 Plan 01 (D-39): leaf-level feedback-enabled subscription. When
  // true AND !isUser, the in-bubble speak button is not rendered (D-03), the
  // bubble's right-side padding pocket collapses from pr-[42px] to pr-[12px]
  // (D-03), and an action strip renders below the bubble carrying speak +
  // thumbs-up + thumbs-down as three peers (D-04/D-05). When false, the
  // bubble renders byte-identically to today (D-02 lock).
  const feedbackEnabled = useFeedbackEnabled();

  // Phase 124 Plan 01 (D-40 option (a) + D-30): thumbs pressed-state, scoped
  // to this ChatMessage instance so it resets on unmount (conversation
  // switch, hydration flush, page reload). Independent per direction — both
  // thumbs may be pressed on the same message (D-29). Second-tap-no-op is
  // enforced in the onClick handlers (D-22/D-28).
  const [thumbsUpPressed, setThumbsUpPressed] = useState<boolean>(false);
  const [thumbsDownPressed, setThumbsDownPressed] = useState<boolean>(false);

  // Cleanup: stop player on unmount if this bubble owns it.
  useEffect(() => {
    return () => {
      if (getCurrentOwner() === bubbleIdRef.current) {
        const owner = bubbleIdRef.current;
        console.info(`[tts] stop-current owner=${owner.toString()} trigger=unmount`);
        getCurrentPlayer()?.stop();
        clearCurrentPlayer();
      }
    };
  }, []);

  // startSpeak: extracted fresh-play path (cross-bubble preempt + loading +
  // fetch + play). Called by onSpeakClick (fresh-play branch). Auto-speak
  // (long-press to read every new reply) was retired 2026-10-06 in favour of
  // hands-free voice mode on the compose mic (useVoiceMode).
  async function startSpeak(trigger: "user-click" = "user-click") {
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
    // 2026-09-28 cutoff investigation: pin whether innerText silently drops
    // rendered content vs the raw message prop by logging both lengths on
    // every invocation. A gap here (innerText < content) means the DOM is
    // hiding text from the speak path — a different bug from Polly
    // truncation, and one we can't tell apart from the backend alone.
    const innerText = containerRef.current?.innerText;
    const text = innerText ?? content;
    const contentLen = content?.length ?? 0;
    const innerTextLen = innerText?.length ?? -1;
    console.info(`[tts] speak-start owner=${owner.toString()} textLen=${text.length} contentLen=${contentLen} innerTextLen=${innerTextLen} voices=[${speakVoices.join(",")}] trigger=${trigger}`);

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
        // Log for observability; UI returns to idle so the user can retry,
        // and a notice says speech stopped (supersedes patch #237's
        // no-toast tradeoff: with selectable TTS providers a failing
        // provider must never look like silence).
        // D-05: extract err fields explicitly — never JSON.stringify(event).
        const errName = err instanceof Error ? err.name : "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`[tts] player-error owner=${owner.toString()} errName="${errName}" errMessage="${errMessage}"`);
        if (getCurrentOwner() === owner) {
          clearCurrentPlayer();
          setSpeakState("idle");
          notifySpeakFailed();
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
      const response = await postSpeakStream(text, speakVoices);
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
        notifySpeakFailed(speakErrorStatus(err));
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
  // inline object literal every render forces ReactMarkdown to remount its
  // child overrides on every parent re-render. Deps are exactly the values
  // the `a` override closes over: eventId, onOpenEditor, eligibleUrls.
  // The p/pre/blockquote overrides only close over module-scope imports
  // (splitMarkers, CopyableBlock) — stable, not deps.
  const markdownComponents = useMemo<Components>(() => ({
    // URL dispatch inside the assistant's rendered markdown:
    //   file URL       → FileChip on its own line (shape 2026-09-28).
    //   interactive-message URL → swap for WidgetBubble (Phase 137 D-137).
    //   anything else  → plain anchor with target=_blank.
    a: ({ node: _node, ...rest }) => {
      const props = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
      const href = props.href;

      // File URL → render as FileChip on its own line inside the bubble.
      // The chip replaces the inline hyperlink entirely; the wrapping span
      // with `display: block` breaks the surrounding paragraph flow so the
      // chip always sits on its own line, even when the URL was originally
      // embedded mid-sentence.
      //
      // `isSkynetFileUrl` guards to same-origin only — an untrusted markdown
      // link like `https://attacker.tld/file/x/tracker.png` must never
      // become a chip whose media source fires a cookie-bearing request off
      // to a third-party origin.
      if (href && isSkynetFileUrl(href) && eventId && onOpenEditor) {
        let filename = "";
        try {
          // Pitfall 8: URL.pathname strips ?query before we split.
          const parsed = new URL(href);
          const segments = parsed.pathname.split("/").filter(Boolean);
          filename = segments.length > 0
            ? decodeURIComponent(segments[segments.length - 1])
            : "";
        } catch {
          // Malformed URL — bail to plain anchor rather than a chip
          // titled with an empty filename.
        }
        // Fallback: if filename extraction produced nothing (URL ends in
        // `/` or something similarly odd) but the URL shape matched, still
        // render a chip so the shape's "every file MUST show up somewhere"
        // invariant holds — better a chip labeled "file" than a silently-
        // dropped URL.
        const displayName = filename || "file";
        return (
          <span className="block my-1.5">
            <FileChip
              url={href}
              filename={displayName}
              onOpen={() =>
                onOpenEditor({
                  messageEventId: eventId,
                  url: href,
                  filename: displayName,
                })
              }
            />
          </span>
        );
      }

      // URL-type dispatch: eligibleUrls is now Map<string, "file" | "interactive-message">
      const urlType = (href && eligibleUrls.get(href)) ?? null;

      // interactive-message: swap anchor ENTIRELY for WidgetBubble
      if (urlType === "interactive-message" && href) {
        return <WidgetBubble src={href} onSubmit={onWidgetSubmit} />;
      }

      // Not a file URL and not an interactive-message URL — plain anchor.
      // Tailnet URLs (legacy) fall here too; per shape they render as
      // plain text-shaped links, not chips.
      return (
        <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
        />
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
  }), [eventId, onOpenEditor, eligibleUrls, onWidgetSubmit]);
  // Phase 50 Plan 03 Task 1 (D-01/D-03/D-06/D-19): user-only pending-state
  // gate. Assistant bubbles ignore the prop; failed supersedes sending
  // (mutually exclusive per Test 6).
  //
  // Phase 76 Plan 02 — D-06 semantic upgrade (user 2026-09-06 verbatim:
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
  // Phase 124 Plan 01 (D-04/D-07 + Pattern S-07 option c): when the strip is
  // present (assistant + feedbackEnabled), the outer flex wrapper also carries
  // `flex-col items-start group` so the strip lives directly below the bubble
  // left-edge-aligned, and Tailwind `group-hover:` on the strip picks up hover
  // over either the bubble OR the strip itself. On feedback-OFF / user cases,
  // the wrapper is byte-identical to today (`flex justify-*`) — no group, no
  // flex-col — so the render path is untouched (D-02 lock).
  return (
    <div
      className={cn(
        "flex",
        isUser ? "justify-end" : "justify-start",
        !isUser && feedbackEnabled && "flex-col items-start group",
      )}
    >
      <div
        ref={containerRef}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={bubbleInlineStyle}
        {...(showFailedBubble ? { "data-pv-bubble-failed": "true" } : {})}
        // pv-bubble: hover-target class for any descendant that opts into
        // a `.pv-bubble:hover_&` Tailwind selector. Historically read by
        // the pencil-edit affordance; kept for future hover-descendants
        // and for OutboundBubble which references the same idiom.
        className={cn(
          "pv-bubble",
          // Phase 4 Glass: raised-object bubble treatment.
          "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          // Phase 124 Plan 01 (D-03): assistant + feedbackEnabled collapses
          // the pr-[42px] speak-button pocket to symmetric pr-[12px] because
          // the in-bubble speak button is not rendered in that branch (it
          // moves to the strip below). User bubbles and feedback-OFF
          // assistant bubbles keep today's padding byte-identically (D-02).
          isUser
            ? "px-[12px] py-[7px]"
            : feedbackEnabled
              ? "pl-[12px] pr-[12px] py-[7px]"
              : "pl-[12px] pr-[42px] py-[7px]",
          "border border-white/[0.08]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
          // Prose scaffolding (typography plugin).
          "prose prose-sm max-w-[90%]",
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
          // Tables: the bubble's overflow-wrap:anywhere shrinks every column's
          // min-content to one character, so on a phone auto layout crushes
          // columns into one-letter-per-line stacks. Undo it inside tables and
          // let a too-wide table scroll sideways within the bubble instead.
          "prose-table:block prose-table:max-w-full prose-table:overflow-x-auto",
          "prose-table:[overflow-wrap:normal] prose-table:[word-break:normal]",
          "prose-th:[overflow-wrap:normal] prose-td:[overflow-wrap:normal]",
          "prose-th:min-w-[4.5em] prose-td:min-w-[4.5em] prose-th:whitespace-nowrap",
          isUser
            ? cn(
                // User bubble = mock's original assistant treatment
                // (translucent mid-blue-gray gradient over the depth). user
                // is always user, no per-pane variation. Reads as the
                // stable "not-the-agent" side; assistant bubbles pop against
                // it with their identity hue.
                "bg-[linear-gradient(160deg,rgba(35,51,90,0.55),rgba(21,32,62,0.6))]",
                "text-[#dfe3ee]",
                "border-[rgba(120,140,180,0.2)]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
                "dark:prose-invert",
              )
            : cn(
                // Assistant carries the identity-hue tint — "the identity is
                // the one speaking these bubbles" semantic. More saturated
                // than the first pass (28% → 50% sat) per user's "colors
                // should be more vibrant" round. Rich hue border + hue outer
                // glow at ~15-20% alpha.
                "pv-hue-surface",
                "bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),75%,38%,0.55),hsla(var(--pv-id-hue),67.5%,24%,0.6))]",
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
          // Sender-side render of an injected user turn. Caption text sits
          // above the file chips inside the SAME bubble.
          //
          // Shape (2026-09-28): if hostName + eventId + onOpenEditor are all
          // available, render each file entry as an interactive FileChip
          // pointing at the file's landing URL on the host — same click
          // contract, media preview, and download control as assistant-side
          // chips. Falls back to the original static AttachmentChipStrip
          // render when any of those are missing (e.g. relay-source mount,
          // no host context, older messages without eventId hooks).
          <>
            {injected.caption.length > 0 && (
              <div className="pv-injected-caption whitespace-pre-wrap mb-2">
                {injected.caption}
              </div>
            )}
            {hostName && eventId && onOpenEditor ? (
              injected.files.map((f) => {
                // Build the Skynet file URL from the browser origin, the
                // target hostname, and the file's absolute landing path.
                // encodeURIComponent per path segment escapes spaces, `?`,
                // `#`, and unicode without swallowing the `/` separator,
                // so a landingPath like `/foo?bar` or `/dir/with space/x`
                // survives correctly and can't inject query / fragment
                // syntax into the URL.
                const chipUrl = buildSkynetFileUrl(hostName, f.landingPath);
                return (
                  <div key={f.landingPath} className="my-1.5">
                    <FileChip
                      url={chipUrl}
                      filename={f.filename}
                      size={f.size}
                      onOpen={() =>
                        onOpenEditor({
                          messageEventId: eventId,
                          url: chipUrl,
                          filename: f.filename,
                        })
                      }
                    />
                  </div>
                );
              })
            ) : (
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
            )}
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
            remarkPlugins={[remarkGfm, remarkBreaks]}
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
        {!isUser && !feedbackEnabled && (
          // Phase 124 Plan 01 (D-02/D-03): in-bubble speak button — ONLY
          // renders on feedback-OFF deployments. When feedbackEnabled is
          // true, this DOM node is ABSENT and speak lives in the strip
          // below (see the strip render below the bubble div). Every visual
          // + interaction state (Loader2/Pause/Play/Volume2 glyphs,
          // hover-lift, touch baseline) is preserved verbatim in the strip
          // copy per D-15/D-16/D-17.
          <button
            type="button"
            onClick={(e) => { void onSpeakClick(e); }}
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
              background: "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              opacity: 0.62,
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className={`pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]`}
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
      {!isUser && feedbackEnabled && (
        // Phase 124 Plan 01 (D-04/D-05): action strip anchored below the
        // assistant bubble, left-edge aligned via the flex-col wrapper (see
        // the outer return below where !isUser && feedbackEnabled wraps
        // bubble+strip in `flex flex-col items-start group`). Three peers
        // in left-to-right order: speak · thumbs-up · thumbs-down (D-05).
        // Resting opacity 0.62 (D-07); hovering anywhere in the group lifts
        // to 100% via Tailwind group-hover (Pattern S-07 option (c)); touch
        // devices sit at 0.72 always-visible baseline (D-08). The strip
        // buttons all share the .pv-speak-btn CSS class hook so shell
        // sizing matches the existing speak button (Pattern S-05).
        <div
          data-testid="pv-chat-message-action-strip"
          className="mt-[4px] pl-[4px] flex items-center gap-[6px] opacity-[0.62] group-hover:opacity-100 [@media(hover:none)]:opacity-[0.72] transition-opacity"
        >
          {/* Strip speak button — duplicates the in-bubble button's handlers
              + glyph state machine verbatim (D-15/D-16/D-17). Position
              stripped: strip is normal flow, not absolute-positioned. */}
          <button
            data-testid="pv-chat-message-speak"
            type="button"
            onClick={(e) => { void onSpeakClick(e); }}
            aria-label={
              speakState === "playing"
                ? "Pause speaking"
                : speakState === "paused"
                  ? "Resume speaking"
                  : "Speak message"
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className={`pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]`}
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
          {/* Thumbs-up — D-18/D-20/D-22. Second-tap-no-op enforced by the
              early return (`if (thumbsUpPressed) return;`) BEFORE any
              callback fires. eventId is required (D-32 makes eventId the
              messageRef); an eventId-less bubble is a defensive no-op. */}
          <button
            data-testid="pv-chat-message-thumbs-up"
            type="button"
            aria-label={
              thumbsUpPressed
                ? "Feedback recorded (thumbs up)"
                : "Send thumbs up feedback"
            }
            onClick={() => {
              if (thumbsUpPressed) return;
              if (!eventId) return;
              setThumbsUpPressed(true);
              onThumbsUp?.(eventId);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: thumbsUpPressed
                ? "hsla(var(--pv-id-hue),65%,55%,0.36)"
                : "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: thumbsUpPressed
                ? "hsla(var(--pv-id-hue),70%,70%,0.45)"
                : "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              opacity: thumbsUpPressed ? 1 : undefined,
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className={`pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]`}
          >
            <ThumbsUp size={16} />
          </button>
          {/* Thumbs-down — D-23/D-26/D-28. Pressed state applies immediately
              on tap (D-26 — before any modal opens); the modal-open logic
              is owned by PrettyView in Plan 02 and consumes the eventId
              from this callback. Second-tap-no-op mirrors thumbs-up. */}
          <button
            data-testid="pv-chat-message-thumbs-down"
            type="button"
            aria-label={
              thumbsDownPressed
                ? "Feedback recorded (thumbs down)"
                : "Send thumbs down feedback"
            }
            onClick={() => {
              if (thumbsDownPressed) return;
              if (!eventId) return;
              setThumbsDownPressed(true);
              onThumbsDown?.(eventId);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: thumbsDownPressed
                ? "hsla(var(--pv-id-hue),65%,55%,0.36)"
                : "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: thumbsDownPressed
                ? "hsla(var(--pv-id-hue),70%,70%,0.45)"
                : "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              opacity: thumbsDownPressed ? 1 : undefined,
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className={`pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]`}
          >
            <ThumbsDown size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
