/**
 * Phase 137 Plan 04 — WidgetBubble: in-bubble iframe wrapper for
 * interactive-message widgets. Mounted by ChatMessage.tsx's `a` markdown
 * override when the URL type is 'interactive-message' (Plan 04 Task 3).
 * Sized for chat flow (fixed 200px height) — NOT full-pane like AppPane.tsx.
 * Retries load failures with exponential backoff (2s/4s/8s, 3 attempts) to
 * cover the sweep-discovery gap between when the agent scaffolds a widget and
 * when it becomes reachable. Validates postMessage origin AND source before
 * dispatching submit signals to the parent (RESEARCH Pitfall 4).
 *
 * Phase 140 Plan 02 — Extended with an expired-placeholder branch: after all
 * 3 retries exhaust and the iframe still fails, the component replaces the
 * iframe with an inline dark-theme card naming the recovery path ("ask the
 * agent to send it again"). This is deliverable C of the lifecycle teardown
 * phase — ensures users see actionable messaging once a widget is torn down
 * by the seven-day backstop.
 */

import { useEffect, useRef, useState } from "react";

// Module-scope: retry delay schedule (exponential backoff). Length is the cap
// on retry attempts — after RETRY_DELAYS_MS.length errors, further errors do
// NOT schedule new retries (Test 4 behavior).
const RETRY_DELAYS_MS = [2000, 4000, 8000];

// Phase 143: iframe height starts small (won't waste vertical space if the
// widget's content is smaller than the previous 200px fixed height) and grows
// via widget-resize postMessages up to MAX_HEIGHT_PX. Past the cap the widget's
// own body scrolls — its stylesheet renders an obvious (chunky) scrollbar.
const INITIAL_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 480;
const MIN_HEIGHT_PX = 40;

export interface WidgetBubbleProps {
  /**
   * The widget URL — already validated as same-origin `/interactive/<hostId>/<slug>/pane/...`
   * by the INTERACTIVE_MSG_URL_RE_CLIENT discriminator upstream.
   * Optional here so component can render standalone in tests.
   */
  src: string;
  /**
   * Phase 137 D-137: parent's widget-submit dispatcher — invoked when the
   * iframe postMessages a widget-submit signal. Wired to PrettyView.tsx's
   * widget-submit dispatcher in Plan 05. Optional so tests + historical mount
   * sites without widget-submit plumbing still work.
   */
  onSubmit?: (widgetId: string, value: string) => void;
}

export function WidgetBubble({ src, onSubmit }: WidgetBubbleProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrySrc, setRetrySrc] = useState(src);
  const [expired, setExpired] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [isClamped, setIsClamped] = useState(false);

  // Retry effect: attaches an error listener to the iframe and schedules
  // exponential-backoff retries on load failure. Runs on [src, retryCount]
  // so each retry attempt re-attaches a fresh listener (the previous error
  // has already been handled and the retry src has been updated).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const onError = () => {
      if (retryCount < RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => {
          setRetryCount((c) => c + 1);
          setRetrySrc(
            src + (src.includes("?") ? "&" : "?") + "_r=" + Date.now(),
          );
        }, RETRY_DELAYS_MS[retryCount]);
      } else {
        // Phase 140: retry cap exhausted — flip to expired-placeholder branch (deliverable C).
        setExpired(true);
      }
    };

    iframe.addEventListener("error", onError);

    return () => {
      iframe.removeEventListener("error", onError);
      if (timer) clearTimeout(timer);
    };
  }, [src, retryCount]);

  // postMessage listener effect: validates BOTH event.source (correct iframe)
  // AND event.origin (same-origin) before dispatching to the parent callback.
  // RESEARCH Pitfall 4: BOTH guards are required — source guards against wrong
  // iframe, origin guards against cross-origin injection.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Guard 1: must originate from THIS widget's iframe (not any other iframe
      // on the page or a sibling WidgetBubble in the same message).
      if (e.source !== iframeRef.current?.contentWindow) return;
      // Guard 2: must be same-origin (D-20 / RESEARCH Pitfall 4). Widgets run
      // on the agent's box but are served via Skynet's own origin via the
      // /interactive/ proxy — so window.location.origin is the correct target.
      if (e.origin !== window.location.origin) return;
      // Phase 143: widget-resize — widget reports its natural content height.
      // The iframe renders at that height; the outer wrapper caps at
      // MAX_HEIGHT_PX with overflow-y: scroll. Scrolling happens on the
      // WRAPPER (parent's DOM), so we can style its scrollbar chunkily via
      // the `chunky-scrollbar` utility. Widget authors don't touch scrollbar
      // CSS at all — the container owns the affordance.
      if (e.data?.type === "widget-resize" && typeof e.data.height === "number") {
        const raw = Math.max(e.data.height, MIN_HEIGHT_PX);
        setContentHeight(raw);
        setIsClamped(raw > MAX_HEIGHT_PX);
        return;
      }
      // Only handle widget-submit signals; other message types are dropped.
      if (e.data?.type === "widget-submit") {
        onSubmit?.(
          String(e.data.widgetId ?? ""),
          String(e.data.value ?? ""),
        );
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSubmit]);

  // Phase 140: expired-placeholder branch — renders after retry exhaustion.
  // Replaces the iframe with an inline dark-theme card that names the recovery
  // path. Visually inert (no clickable elements); role="status" signals the
  // inert state to assistive technology.
  if (expired) {
    return (
      <div
        role="status"
        aria-label="Expired interactive message"
        className="w-full rounded-md border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70"
      >
        <div className="flex items-start gap-2">
          <span aria-hidden="true">⏱</span>
          <div>
            <div className="font-medium text-white/85">This interactive message expired.</div>
            <div className="text-white/60">Ask the agent to send it again if you still need it.</div>
          </div>
        </div>
      </div>
    );
  }

  // Phase 143: outer scroll wrapper owns the scrollbar. Iframe renders at its
  // natural (reported) height; wrapper caps + scrolls. This puts the scrollbar
  // on the parent's DOM so we can style it with the `chunky-scrollbar`
  // utility — the iframe's own scrollbar (macOS Chromium overlay/auto-hide)
  // never comes into play.
  //
  // overflow-y toggles: `scroll` when clamped (rail reserved + always visible),
  // `hidden` when fits (no rail, iframe already sized to natural height).
  return (
    <div
      className={`relative w-full rounded-md ${isClamped ? "chunky-scrollbar" : ""}`}
      style={{
        maxHeight: `${MAX_HEIGHT_PX}px`,
        overflowY: isClamped ? "scroll" : "hidden",
      }}
    >
      <iframe
        ref={iframeRef}
        src={retrySrc}
        title="Interactive widget"
        referrerPolicy="no-referrer"
        loading="eager"
        className="w-full border-0 rounded-md"
        style={{
          height: `${contentHeight ?? INITIAL_HEIGHT_PX}px`,
          transition: "height 120ms ease-out",
          display: "block",
        }}
      />
    </div>
  );
}
