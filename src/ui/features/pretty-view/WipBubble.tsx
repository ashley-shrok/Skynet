// Patch #51 introduced the WIP indicator; patch #72 reworked it.
// Patch #86 (2026-07-20): canvas Fibonacci-lattice 3D dot-orb.
// Patch #260 (2026-08-02): canvas "voxel cube" — 4×4×4 lattice (64 dots)
// rotating on two axes with a radial pulse. Selected by user from a
// gallery ("Dense 4³" at 2.5× base speed, 1.5× original 50px footprint).
//
// 2026-09-05: a pre-rendered animated image replaced the canvas (the rAF
// repaint burned 40–50% idle CPU); retired with the image on 2026-10-28.
//
// 2026-10-24 (shape-conversation-view): an orb in the agent's colour — an
// arc spinning around an empty middle, beside the word "Working"
// (conversation.css .pv-wip*). Only transform / opacity animate, so it costs
// nothing per frame. A mark inside the orb means it's a button.
//
// 2026-10-28 (shape-stop-on-orb): the orb is the Stop — the compose box has
// none. While the agent's own turn can be stopped, a still small square sits
// in the middle and a button lies over the orb. When it can't (only background
// helpers running, a message still being delivered) there is no button and no
// square — nothing says "Stop", to the eye or to a screen reader. The button is laid
// over the orb rather than wrapped around it, so the orb itself never
// remounts and its spin never restarts. After a press the ring pauses and the
// line shows the outcome (Stopping → Stopped / Cancelled / …); PrettyView
// keeps the indicator mounted until that outcome has shown. The same orb on
// every installation — the branding custom-image option is gone.
//
// Mount condition: PrettyView's agentWorking (main turn working, or a
// background sub-agent running), or a Stop outcome still showing.
//
// Deliberately NOT a bubble, so at-a-glance parsing distinguishes "session is
// busy" from "assistant said something." role="status" + aria-label carry
// semantics for AT (on the orb, so the Stop button sits outside the live
// region).
//
// Work narration (2026-10-25): an optional one-line "where the agent is in
// the job" from the backend, in a short and a long version. Once the turn's
// first line arrives it takes the place of "Working"; the long version shows
// when it fits on one
// line, else the short one. Never wraps. A new line fades in over the old one.
// A Stop outcome takes the line's place while it shows.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { INTERRUPT_FEEDBACK_LABEL, type InterruptFeedback } from "./interrupt-feedback";

const FADE_MS = 200;

type Narration = { short: string; long: string };

function NarrationLine({ line, className }: { line: Narration; className: string }) {
  // The line on screen. A new line fades out the old one first.
  const [shown, setShown] = useState(line);
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    if (line.short === shown.short && line.long === shown.long) {
      // Back to the line already on screen mid-fade: make sure it's visible.
      setOpaque(true);
      return;
    }
    setOpaque(false);
    const t = setTimeout(() => {
      setShown(line);
      setOpaque(true);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [line, shown]);

  // Long version when it fits on one line in the space available, else short.
  const slotRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [longFits, setLongFits] = useState(true);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const measure = measureRef.current;
    if (!slot || !measure) return;
    const check = () => setLongFits(measure.offsetWidth <= slot.clientWidth);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [shown.long]);

  return (
    <span ref={slotRef} className="relative block min-w-0 flex-1">
      <span
        ref={measureRef}
        aria-hidden="true"
        className={`pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap ${className}`}
      >
        {shown.long}
      </span>
      <span
        data-testid="wip-narration"
        className={`block overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${className}`}
        style={{ opacity: opaque ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        {longFits ? shown.long : shown.short}
      </span>
    </span>
  );
}

/** The orb as Stop. Omitted where nothing can be stopped (read-only views). */
export type WipStop = {
  /** A press would stop something right now: the orb shows the square. */
  canStop: boolean;
  onStop: () => void;
  /** What the last press is doing / did; null when there is none to show. */
  feedback: InterruptFeedback | null;
};

export function WipBubble({
  narration = null,
  stop,
  label = "Claude is working",
}: {
  narration?: Narration | null;
  stop?: WipStop;
  /** What screen readers hear for the orb. */
  label?: string;
}) {
  const feedback = stop?.feedback ?? null;
  const ready = stop !== undefined && stop.canStop && feedback === null;
  const state = feedback ? "pressed" : ready ? "ready" : "working";
  const showLine = narration !== null && feedback === null;
  // A keyboard press takes the button away (the outcome shows instead), so
  // focus moves to the indicator, where the outcome is announced; when the
  // indicator goes away still holding focus, focus goes on to the compose box
  // rather than dropping to the top of the page.
  const wipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wip = wipRef.current;
    // Layout-effect cleanup runs before the node leaves the document.
    return () => {
      if (!wip || !wip.contains(document.activeElement)) return;
      wip.closest("[data-pv-root]")?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    };
  }, []);
  const onPress = (e: MouseEvent<HTMLButtonElement>) => {
    let keyboard = false;
    try {
      keyboard = e.currentTarget.matches(":focus-visible");
    } catch {
      /* selector unsupported — leave focus alone */
    }
    stop?.onStop();
    if (keyboard) wipRef.current?.focus();
  };
  return (
    <div className="flex justify-start">
      <div
        ref={wipRef}
        tabIndex={-1}
        className="pv-wip"
        data-testid="pv-wip"
        data-stop={state}
        // With a line, the indicator spans the row so the line can use the room.
        style={showLine ? { display: "flex", flex: "1 1 auto", minWidth: 0 } : undefined}
      >
        <span className="pv-wip-orbwrap">
          {ready && (
            <button
              type="button"
              className="pv-wip-stop"
              data-testid="pv-wip-stop"
              onClick={onPress}
              aria-label="Stop"
              title="Stop"
            />
          )}
          {/* A mark inside the orb means it's a button: the square shows only
              while a press would stop something; otherwise the ring is empty. */}
          <span className="pv-wip-orb" role="status" aria-label={label}>
            {ready && <i aria-hidden="true" />}
          </span>
        </span>
        {feedback ? (
          <span className="pv-wip-word" data-testid="interrupt-feedback" data-feedback={feedback} aria-hidden="true">
            {INTERRUPT_FEEDBACK_LABEL[feedback]}
          </span>
        ) : showLine ? (
          <NarrationLine line={narration} className="pv-wip-word" />
        ) : (
          <span className="pv-wip-word" aria-hidden="true">
            Working
          </span>
        )}
      </div>
      {/* Mounted whenever Stop is wired, before any press, so screen readers
          hear "Stopping" too — a live region created along with its text is
          often not announced. */}
      {stop && (
        <span role="status" aria-live="polite" className="sr-only">
          {feedback ? INTERRUPT_FEEDBACK_LABEL[feedback] : ""}
        </span>
      )}
    </div>
  );
}
