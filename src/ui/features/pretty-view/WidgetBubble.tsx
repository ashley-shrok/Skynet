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
      // Phase 143: widget-resize — widget reports its content height so the
      // iframe can grow to fit (up to MAX_HEIGHT_PX). If the reported height
      // exceeds the cap the parent renders an overflow cue (fade + chevron)
      // so users see "there's more below" regardless of the browser's native
      // scrollbar auto-hide behavior. Overflow-indication is the container's
      // job — widget authors don't need to build it themselves.
      if (e.data?.type === "widget-resize" && typeof e.data.height === "number") {
        const raw = e.data.height;
        const clamped = Math.min(Math.max(raw, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
        setContentHeight(clamped);
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

  // Phase 137: no dark-mode injection or drag pass-through — deferred to Phase 2/3
  // per RESEARCH Pattern 5. Widgets author their own dark mode since they're
  // agent-authored HTML; drag pass-through is a Phase 2 concern.
  return (
    <div className="relative w-full">
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
        }}
      />
      {isClamped && (
        <div
          aria-hidden="true"
          data-testid="widget-overflow-cue"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center pb-1 text-sm rounded-b-md"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(0,0,0,0.16) 60%, rgba(0,0,0,0.24))",
            color: "rgba(255,255,255,0.75)",
          }}
        >
          <span>▾</span>
        </div>
      )}
    </div>
  );
}
