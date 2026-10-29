/**
 * gestures — turns touches on a remote desktop into mouse intent.
 *
 * Pure: it is fed touch points (client coordinates) and a clock, and emits
 * actions; the touch controller applies them to the remote mouse and the
 * zoomed view. No DOM, so every gesture is unit-testable.
 *
 * Trackpad (phone default): one finger slides the cursor; tap = left click;
 * two-finger tap = right click; double-tap-and-hold then drag = drag; two
 * fingers sliding = scroll.
 * Direct (tablet default): tap clicks under the finger; press and hold =
 * right click; one-finger drag = drag; two fingers sliding scroll, or move
 * the view while zoomed in.
 * Scroll-only (telnet): one or two fingers sliding scroll; nothing clicks.
 * Pinch zooms (and the midpoint pans) in trackpad and direct.
 *
 * Ambiguity does nothing: a gesture commits to one meaning once it has moved
 * enough to tell, and keeps it until every finger has lifted — a pinch never
 * becomes a click or a drag partway through.
 */

export type TouchMouseMode = "trackpad" | "direct";
export type GestureMode = TouchMouseMode | "scroll-only";

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export type GestureAction =
  /** Trackpad: move the cursor by a screen-pixel delta. */
  | { type: "cursor-by"; dx: number; dy: number }
  /** Direct: put the cursor under this client point. */
  | { type: "cursor-to"; x: number; y: number }
  | { type: "button"; button: "left" | "right"; down: boolean }
  | { type: "wheel"; direction: "up" | "down" }
  /** Multiply the zoom by `factor`, keeping client point (cx, cy) fixed. */
  | { type: "zoom"; factor: number; cx: number; cy: number }
  /** Move the picture by a screen-pixel delta. */
  | { type: "pan"; dx: number; dy: number };

export interface GestureTimers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface GestureOptions {
  mode: GestureMode;
  emit: (action: GestureAction) => void;
  /** Whether the view is zoomed in (direct mode: two fingers pan instead of scroll). */
  isZoomed: () => boolean;
  /**
   * Direct mode: whether a client point is on the desktop picture. A touch
   * that starts off it (the letterbox bars) never clicks or drags.
   */
  isOnPicture?: (x: number, y: number) => boolean;
  timers?: GestureTimers;
}

/** Movement (px) under which a touch is still a tap / hold. */
export const SLOP_PX = 10;
/** A tap is a touch shorter than this. */
export const TAP_MS = 300;
/** Second touch within this long (and this close) after a tap can start a drag. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 40;
/** Direct mode: holding this long without moving is a right click. */
export const HOLD_MS = 500;
/** Change in finger spread (px) that makes two fingers a pinch. */
export const PINCH_PX = 24;
/** Finger travel (px) per wheel tick. */
export const SCROLL_STEP_PX = 24;
/**
 * A one-finger move this soon after touchdown waits before pressing the
 * button (direct drag, trackpad double-tap drag): fingers rarely land
 * together, and a pinch's first finger must not start a drag.
 */
export const DRAG_DELAY_MS = 100;

type State =
  | { kind: "idle" }
  | {
      kind: "one-pending";
      id: number;
      start: TouchPoint;
      startTime: number;
      afterTap: boolean;
      /** Direct mode: started on the picture (off it, nothing clicks). */
      onPicture: boolean;
    }
  | { kind: "one-move"; id: number; last: TouchPoint }
  | { kind: "one-drag"; id: number; last: TouchPoint }
  | { kind: "one-scroll"; id: number; lastY: number; accum: number }
  | {
      kind: "two-pending";
      startTime: number;
      startDist: number;
      startMid: { x: number; y: number };
      maxTravel: number;
      startPts: Map<number, TouchPoint>;
    }
  | { kind: "pinch"; lastDist: number; lastMid: { x: number; y: number } }
  | { kind: "two-scroll"; lastMid: { x: number; y: number }; accum: number }
  | { kind: "two-pan"; lastMid: { x: number; y: number } }
  /** Finished or abandoned — wait until every finger lifts. */
  | { kind: "ignore" };

const realTimers: GestureTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GestureRecognizer {
  private readonly opts: GestureOptions;
  private readonly timers: GestureTimers;
  private readonly touches = new Map<number, TouchPoint>();
  private state: State = { kind: "idle" };
  private holdTimer: unknown = null;
  private lastTap: { time: number; x: number; y: number } | null = null;

  constructor(opts: GestureOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? realTimers;
  }

  get mode(): GestureMode {
    return this.opts.mode;
  }

  /** Name of the current state (for logs and tests). */
  get stateKind(): string {
    return this.state.kind;
  }

  down(points: TouchPoint[]): void {
    for (const p of points) this.touches.set(p.id, { ...p });
    const count = this.touches.size;
    const s = this.state;
    const now = this.timers.now();

    if (count === 1 && s.kind === "idle") {
      const p = points[points.length - 1];
      const tap = this.lastTap;
      const afterTap =
        this.opts.mode === "trackpad" &&
        !!tap &&
        now - tap.time < DOUBLE_TAP_MS &&
        dist(tap, p) < DOUBLE_TAP_PX;
      const onPicture =
        this.opts.mode !== "direct" || (this.opts.isOnPicture?.(p.x, p.y) ?? true);
      this.state = { kind: "one-pending", id: p.id, start: { ...p }, startTime: now, afterTap, onPicture };
      if (this.opts.mode === "direct" && onPicture) {
        this.holdTimer = this.timers.setTimeout(() => this.onHold(), HOLD_MS);
      }
      return;
    }

    // Two fingers — landing together (one event) or one after the other.
    if (
      count === 2 &&
      (s.kind === "idle" || s.kind === "one-pending" || s.kind === "one-move" || s.kind === "one-scroll")
    ) {
      this.clearHold();
      const pts = [...this.touches.values()];
      this.state = {
        kind: "two-pending",
        startTime: now,
        startDist: dist(pts[0], pts[1]),
        startMid: mid(pts),
        maxTravel: 0,
        startPts: new Map(pts.map((q) => [q.id, { ...q }])),
      };
      return;
    }

    // A drag in progress keeps going; extra fingers are ignored.
    if (s.kind === "one-drag") return;

    // Anything else (a third finger, a finger landing on a finished gesture)
    // abandons the gesture.
    this.abandon();
  }

  move(points: TouchPoint[]): void {
    for (const p of points) {
      if (this.touches.has(p.id)) this.touches.set(p.id, { ...p });
    }
    const s = this.state;
    const { mode, emit } = this.opts;

    switch (s.kind) {
      case "one-pending": {
        const p = this.touches.get(s.id);
        if (!p || dist(p, s.start) <= SLOP_PX) return;
        const pressesButton = mode === "direct" || (mode === "trackpad" && s.afterTap);
        if (pressesButton && this.timers.now() - s.startTime < DRAG_DELAY_MS) return;
        this.clearHold();
        if (mode === "direct" && !s.onPicture) {
          this.state = { kind: "ignore" };
          return;
        }
        if (mode === "scroll-only") {
          this.state = { kind: "one-scroll", id: s.id, lastY: s.start.y, accum: 0 };
          this.scrollBy(p.y - s.start.y);
          (this.state as { lastY: number }).lastY = p.y;
          return;
        }
        if (mode === "trackpad") {
          if (s.afterTap) emit({ type: "button", button: "left", down: true });
          emit({ type: "cursor-by", dx: p.x - s.start.x, dy: p.y - s.start.y });
          this.state = { kind: s.afterTap ? "one-drag" : "one-move", id: s.id, last: { ...p } };
          return;
        }
        // direct
        emit({ type: "cursor-to", x: s.start.x, y: s.start.y });
        emit({ type: "button", button: "left", down: true });
        emit({ type: "cursor-to", x: p.x, y: p.y });
        this.state = { kind: "one-drag", id: s.id, last: { ...p } };
        return;
      }
      case "one-move":
      case "one-drag": {
        const p = this.touches.get(s.id);
        if (!p) return;
        if (mode === "direct") {
          emit({ type: "cursor-to", x: p.x, y: p.y });
        } else {
          emit({ type: "cursor-by", dx: p.x - s.last.x, dy: p.y - s.last.y });
        }
        s.last = { ...p };
        return;
      }
      case "one-scroll": {
        const p = this.touches.get(s.id);
        if (!p) return;
        this.scrollBy(p.y - s.lastY);
        s.lastY = p.y;
        return;
      }
      case "two-pending": {
        const pts = [...this.touches.values()];
        if (pts.length < 2) return;
        for (const q of pts) {
          const start = s.startPts.get(q.id);
          if (start) s.maxTravel = Math.max(s.maxTravel, dist(q, start));
        }
        const d = dist(pts[0], pts[1]);
        const m = mid(pts);
        if (mode !== "scroll-only" && Math.abs(d - s.startDist) > PINCH_PX) {
          this.state = { kind: "pinch", lastDist: s.startDist, lastMid: s.startMid };
          this.pinchTo(d, m);
          return;
        }
        if (dist(m, s.startMid) > SLOP_PX) {
          if (mode === "direct" && this.opts.isZoomed()) {
            this.state = { kind: "two-pan", lastMid: s.startMid };
            this.panTo(m);
          } else {
            // Direct: scroll what's under the fingers.
            if (mode === "direct") emit({ type: "cursor-to", x: m.x, y: m.y });
            this.state = { kind: "two-scroll", lastMid: s.startMid, accum: 0 };
            this.scrollBy(m.y - s.startMid.y);
            (this.state as { lastMid: { x: number; y: number } }).lastMid = m;
          }
        }
        return;
      }
      case "pinch": {
        const pts = [...this.touches.values()];
        if (pts.length < 2) return;
        this.pinchTo(dist(pts[0], pts[1]), mid(pts));
        return;
      }
      case "two-pan": {
        const pts = [...this.touches.values()];
        if (pts.length < 2) return;
        this.panTo(mid(pts));
        return;
      }
      case "two-scroll": {
        const pts = [...this.touches.values()];
        if (pts.length < 2) return;
        const m = mid(pts);
        this.scrollBy(m.y - s.lastMid.y);
        s.lastMid = m;
        return;
      }
      default:
        return;
    }
  }

  up(ids: number[]): void {
    const s = this.state;
    const { mode, emit } = this.opts;
    const now = this.timers.now();
    const lifted = ids.filter((id) => this.touches.has(id));
    for (const id of lifted) this.touches.delete(id);
    if (lifted.length === 0) return;

    switch (s.kind) {
      case "one-pending": {
        this.clearHold();
        if (mode === "trackpad") {
          if (now - s.startTime < TAP_MS) {
            emit({ type: "button", button: "left", down: true });
            emit({ type: "button", button: "left", down: false });
            // A double-tap's second tap doesn't arm a third-touch drag.
            this.lastTap = s.afterTap ? null : { time: now, x: s.start.x, y: s.start.y };
          }
        } else if (mode === "direct" && s.onPicture) {
          emit({ type: "cursor-to", x: s.start.x, y: s.start.y });
          emit({ type: "button", button: "left", down: true });
          emit({ type: "button", button: "left", down: false });
        }
        this.state = { kind: "idle" };
        break;
      }
      case "one-drag": {
        if (lifted.includes(s.id)) {
          emit({ type: "button", button: "left", down: false });
          this.state = { kind: "ignore" };
        }
        break;
      }
      case "two-pending": {
        if (
          mode === "trackpad" &&
          now - s.startTime < TAP_MS &&
          s.maxTravel <= SLOP_PX
        ) {
          emit({ type: "button", button: "right", down: true });
          emit({ type: "button", button: "right", down: false });
        }
        this.state = { kind: "ignore" };
        break;
      }
      case "one-move":
      case "one-scroll":
      case "pinch":
      case "two-scroll":
      case "two-pan":
        this.state = { kind: "ignore" };
        break;
      default:
        break;
    }

    if (this.touches.size === 0) this.state = { kind: "idle" };
  }

  /** Ids of the fingers this recognizer thinks are down. */
  get activeIds(): number[] {
    return [...this.touches.keys()];
  }

  /** Touches were taken away (touchcancel, mode switch, unmount). */
  cancel(): void {
    this.abandon();
    this.touches.clear();
    this.state = { kind: "idle" };
    this.lastTap = null;
  }

  private abandon(): void {
    this.clearHold();
    if (this.state.kind === "one-drag") {
      this.opts.emit({ type: "button", button: "left", down: false });
    }
    this.state = this.touches.size === 0 ? { kind: "idle" } : { kind: "ignore" };
  }

  private onHold(): void {
    this.holdTimer = null;
    const s = this.state;
    if (s.kind !== "one-pending" || this.opts.mode !== "direct") return;
    const { emit } = this.opts;
    emit({ type: "cursor-to", x: s.start.x, y: s.start.y });
    emit({ type: "button", button: "right", down: true });
    emit({ type: "button", button: "right", down: false });
    this.state = { kind: "ignore" };
  }

  private clearHold(): void {
    if (this.holdTimer !== null) {
      this.timers.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /** Natural scrolling: fingers moving up show what's further down. */
  private scrollBy(dy: number): void {
    const s = this.state;
    if (s.kind !== "one-scroll" && s.kind !== "two-scroll") return;
    s.accum += dy;
    while (s.accum <= -SCROLL_STEP_PX) {
      this.opts.emit({ type: "wheel", direction: "down" });
      s.accum += SCROLL_STEP_PX;
    }
    while (s.accum >= SCROLL_STEP_PX) {
      this.opts.emit({ type: "wheel", direction: "up" });
      s.accum -= SCROLL_STEP_PX;
    }
  }

  private pinchTo(d: number, m: { x: number; y: number }): void {
    const s = this.state;
    if (s.kind !== "pinch") return;
    // Pan first (the spot under the old midpoint follows the fingers), then
    // zoom about the new midpoint.
    if (m.x !== s.lastMid.x || m.y !== s.lastMid.y) {
      this.opts.emit({ type: "pan", dx: m.x - s.lastMid.x, dy: m.y - s.lastMid.y });
    }
    if (s.lastDist > 0 && d > 0) {
      this.opts.emit({ type: "zoom", factor: d / s.lastDist, cx: m.x, cy: m.y });
    }
    s.lastDist = d;
    s.lastMid = m;
  }

  private panTo(m: { x: number; y: number }): void {
    const s = this.state;
    if (s.kind !== "two-pan") return;
    this.opts.emit({ type: "pan", dx: m.x - s.lastMid.x, dy: m.y - s.lastMid.y });
    s.lastMid = m;
  }
}

function mid(pts: TouchPoint[]): { x: number; y: number } {
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}
