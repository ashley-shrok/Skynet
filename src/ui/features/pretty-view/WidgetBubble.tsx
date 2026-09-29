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
 *
 * Post-load liveness polling — after the iframe has loaded at least once, a
 * lightweight interval probes the widget URL. Three consecutive failures flip
 * the same expired state used by the initial-load branch. This catches the
 * mid-conversation tear-down case (iterate-widget rekey, manual teardown)
 * where the iframe has successfully loaded but its backend server later
 * disappears — without a probe the iframe stays looking live indefinitely
 * because nothing else triggers a re-fetch. Polling stops on unmount and once
 * expired.
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

// Post-load liveness poll: after the iframe has loaded once, probe the widget
// URL every POLL_INTERVAL_MS. POLL_FAIL_THRESHOLD consecutive failures flip
// the component to expired. 500ms × 3 = ~1.5s detection after tear-down;
// tolerates network blips up to ~1s.
const POLL_INTERVAL_MS = 500;
const POLL_FAIL_THRESHOLD = 3;

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrySrc, setRetrySrc] = useState(src);
  const [expired, setExpired] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [isClamped, setIsClamped] = useState(false);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);

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

  // Post-load liveness poll — gated on hasLoaded so it doesn't race the
  // initial-load retry sequence (backend proxy may return 502 briefly while
  // the widget's systemd unit is starting). Once the iframe fires load at
  // least once, poll `src` every POLL_INTERVAL_MS; POLL_FAIL_THRESHOLD
  // consecutive non-2xx or network errors flip to the expired state.
  useEffect(() => {
    if (!hasLoaded || expired) return;

    let failCount = 0;
    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(src, { method: "GET", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          failCount = 0;
        } else {
          failCount += 1;
        }
      } catch {
        if (cancelled) return;
        failCount += 1;
      }
      if (!cancelled && failCount >= POLL_FAIL_THRESHOLD) {
        setExpired(true);
      }
    };

    const interval = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasLoaded, expired, src]);

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

  // Phase 143: track scroll position for the DOM-based fake thumb. Modern
  // Chromium's overlay-scrollbar mode auto-hides the native scrollbar even
  // under ::-webkit-scrollbar styling, so we paint our own always-visible
  // thumb absolutely-positioned inside the wrapper. Recomputes on scroll +
  // wrapper resize + iframe height change.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !isClamped) {
      setThumb(null);
      return;
    }
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = wrapper;
      if (scrollHeight <= clientHeight + 1) {
        setThumb(null);
        return;
      }
      const padding = 8; // top/bottom breathing room inside the track
      const trackHeight = clientHeight - padding * 2;
      const minThumb = 30;
      const ratio = clientHeight / scrollHeight;
      const height = Math.max(minThumb, Math.round(trackHeight * ratio));
      const scrollable = scrollHeight - clientHeight;
      const scrollRatio = scrollable > 0 ? scrollTop / scrollable : 0;
      const top = padding + Math.round((trackHeight - height) * scrollRatio);
      setThumb({ top, height });
    };
    update();
    wrapper.addEventListener("scroll", update, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(wrapper);
    }
    return () => {
      wrapper.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [isClamped, contentHeight]);

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

  // Phase 143: relative container holds the scrolling wrapper + a
  // sibling fake thumb. Sibling (not child of the scroll wrapper) so the
  // thumb's absolute position is relative to the VIEWPORT area of the
  // container, not the scrollable content — it stays visually anchored to
  // the right edge as the iframe scrolls inside the wrapper.
  //
  // Native scrollbar is hidden via widget-scroll-wrapper utility (Chromium's
  // overlay-scrollbar auto-hide beats CSS styling; can't fight it). The
  // wrapper still scrolls via wheel/touch/keyboard — only the native
  // indicator is invisible.
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div
        ref={wrapperRef}
        className={`w-full ${isClamped ? "widget-scroll-wrapper" : ""}`}
        style={{
          maxHeight: `${MAX_HEIGHT_PX}px`,
          overflowY: isClamped ? "auto" : "hidden",
        }}
      >
        <iframe
          ref={iframeRef}
          src={retrySrc}
          title="Interactive widget"
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={() => setHasLoaded(true)}
          className="w-full border-0"
          style={{
            height: `${contentHeight ?? INITIAL_HEIGHT_PX}px`,
            transition: "height 120ms ease-out",
            display: "block",
          }}
        />
      </div>
      {thumb && (
        <div
          aria-hidden="true"
          data-testid="widget-scroll-thumb"
          style={{
            position: "absolute",
            top: thumb.top,
            right: 4,
            width: 8,
            height: thumb.height,
            background: "rgba(255,255,255,0.4)",
            borderRadius: 4,
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}
