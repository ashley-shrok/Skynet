/**
 * touch-controller — binds touches on a remote desktop's box to the remote
 * mouse and the zoomed view.
 *
 * Touch events are taken whole (default prevented), so the page never
 * scrolls or zooms underneath and the browser never turns them into mouse
 * events. The gesture recognizer says what the touches mean; this applies it:
 * moves the remote cursor (kept in remote pixels), presses buttons, sends
 * wheel ticks, and zooms / moves the view, handing every view change to the
 * display to draw.
 */

import { systemLogger } from "@/lib/frontend-logger";
import {
  GestureRecognizer,
  type GestureAction,
  type GestureMode,
  type GestureTimers,
  type TouchPoint,
} from "./gestures";
import {
  followPoint,
  panBy,
  remoteToScreen,
  screenToRemote,
  viewScale,
  zoomAt,
  type Box,
  type RemoteSize,
  type ViewState,
} from "./viewport";

/** How close (px) the trackpad cursor gets to an edge before the view follows it. */
export const EDGE_MARGIN_PX = 24;

export interface MouseButtons {
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface TouchControllerOptions {
  element: HTMLElement;
  mode: GestureMode;
  getRemote: () => RemoteSize;
  /** The visible part of the display area, in client coordinates. */
  getBox: () => Box;
  view: ViewState;
  onViewChange: (view: ViewState) => void;
  /** Send the mouse at a remote-pixel position. */
  sendMouse: (x: number, y: number, buttons: MouseButtons) => void;
  /** Any touch began (e.g. give the display keyboard focus). */
  onTouchStart?: () => void;
  timers?: GestureTimers;
}

export class TouchController {
  private readonly opts: TouchControllerOptions;
  private recognizer: GestureRecognizer;
  private view: ViewState;
  private cursor: { x: number; y: number } | null = null;
  private buttons: MouseButtons = { left: false, middle: false, right: false, up: false, down: false };
  private readonly cleanups: Array<() => void> = [];
  private zoomLogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TouchControllerOptions) {
    this.opts = opts;
    this.view = { ...opts.view };
    this.recognizer = this.makeRecognizer(opts.mode);

    const el = opts.element;
    const listen = (type: string, fn: (e: TouchEvent) => void) => {
      el.addEventListener(type, fn as EventListener, { passive: false });
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener));
    };
    listen("touchstart", (e) => {
      e.preventDefault();
      // After dropping a lost finger, start over from the fingers really down.
      const reseed = this.dropLostTouches(e);
      this.opts.onTouchStart?.();
      this.recognizer.down(points(reseed ? e.touches : e.changedTouches));
    });
    listen("touchmove", (e) => {
      e.preventDefault();
      this.dropLostTouches(e);
      this.recognizer.move(points(e.changedTouches));
    });
    listen("touchend", (e) => {
      e.preventDefault();
      this.recognizer.up(ids(e.changedTouches));
      // Every finger is up: anything still remembered was lost.
      if (e.touches && e.touches.length === 0 && this.recognizer.activeIds.length > 0) {
        this.recognizer.cancel();
      }
    });
    listen("touchcancel", () => this.recognizer.cancel());
    // Switching away mid-touch can swallow the touch's end.
    const onHidden = () => {
      if (document.visibilityState !== "visible") this.recognizer.cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onHidden));
    // iOS Safari's own page pinch.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stopGesture);
    this.cleanups.push(() => el.removeEventListener("gesturestart", stopGesture));
  }

  get currentView(): ViewState {
    return { ...this.view };
  }

  get currentMode(): GestureMode {
    return this.recognizer.mode;
  }

  setMode(mode: GestureMode): void {
    if (mode === this.recognizer.mode) return;
    this.recognizer.cancel();
    this.recognizer = this.makeRecognizer(mode);
  }

  /** The box changed size (keyboard up/down, rotation): re-clamp, keep the pointer in view. */
  refit(): void {
    const box = this.opts.getBox();
    const remote = this.opts.getRemote();
    let next = panBy(this.view, box, remote, 0, 0);
    if (this.cursor && next.zoom > 1) {
      next = followPoint(next, box, remote, this.cursor, EDGE_MARGIN_PX);
    }
    this.setView(next, false);
  }

  destroy(): void {
    this.recognizer.cancel();
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    if (this.zoomLogTimer) clearTimeout(this.zoomLogTimer);
  }

  /**
   * A finger whose end never reached this element (what it landed on was
   * removed, or the app was switched away) would otherwise count forever —
   * the next tap reading as two fingers. If the browser no longer lists a
   * finger the gesture remembers, abandon the gesture.
   */
  private dropLostTouches(e: TouchEvent): boolean {
    if (!e.touches) return false;
    const live = new Set<number>();
    for (let i = 0; i < e.touches.length; i++) live.add(e.touches[i].identifier);
    const lost = this.recognizer.activeIds.filter((id) => !live.has(id));
    if (lost.length > 0) {
      systemLogger.info("[touch-input] lost touch dropped", {
        operation: "touch_lost_dropped",
        lost: lost.length,
      });
      this.recognizer.cancel();
      return true;
    }
    return false;
  }

  private makeRecognizer(mode: GestureMode): GestureRecognizer {
    return new GestureRecognizer({
      mode,
      emit: (a) => this.apply(a),
      isZoomed: () => this.view.zoom > 1.001,
      isOnPicture: (x, y) => {
        const remote = this.opts.getRemote();
        const r = screenToRemote(this.view, this.opts.getBox(), remote, { x, y });
        return r.x >= 0 && r.y >= 0 && r.x < remote.width && r.y < remote.height;
      },
      timers: this.opts.timers,
    });
  }

  private apply(a: GestureAction): void {
    const box = this.opts.getBox();
    const remote = this.opts.getRemote();
    if (remote.width <= 0 || remote.height <= 0) return;
    switch (a.type) {
      case "cursor-by": {
        const s = viewScale(this.view, box, remote);
        const c = this.cursor ?? { x: remote.width / 2, y: remote.height / 2 };
        this.cursor = clampToRemote({ x: c.x + a.dx / s, y: c.y + a.dy / s }, remote);
        this.send();
        if (this.view.zoom > 1) {
          this.setView(followPoint(this.view, box, remote, this.cursor, EDGE_MARGIN_PX), false);
        }
        return;
      }
      case "cursor-to": {
        this.cursor = clampToRemote(screenToRemote(this.view, box, remote, { x: a.x, y: a.y }), remote);
        this.send();
        return;
      }
      case "button": {
        if (!this.cursor) this.cursor = { x: remote.width / 2, y: remote.height / 2 };
        this.buttons = { ...this.buttons, [a.button]: a.down };
        this.send();
        return;
      }
      case "wheel": {
        if (!this.cursor) this.cursor = { x: remote.width / 2, y: remote.height / 2 };
        this.buttons = { ...this.buttons, [a.direction]: true };
        this.send();
        this.buttons = { ...this.buttons, [a.direction]: false };
        this.send();
        return;
      }
      case "zoom": {
        this.setView(zoomAt(this.view, box, remote, a.factor, a.cx, a.cy), true);
        return;
      }
      case "pan": {
        this.setView(panBy(this.view, box, remote, a.dx, a.dy), false);
        return;
      }
    }
  }

  private send(): void {
    if (!this.cursor) return;
    this.opts.sendMouse(Math.round(this.cursor.x), Math.round(this.cursor.y), this.buttons);
  }

  private setView(next: ViewState, zoomed: boolean): void {
    const v = this.view;
    if (next.zoom === v.zoom && next.tx === v.tx && next.ty === v.ty) return;
    this.view = next;
    this.opts.onViewChange({ ...next });
    if (zoomed) this.logZoomSoon();
  }

  /** One log line when a pinch settles, not one per frame. */
  private logZoomSoon(): void {
    if (this.zoomLogTimer) clearTimeout(this.zoomLogTimer);
    this.zoomLogTimer = setTimeout(() => {
      this.zoomLogTimer = null;
      systemLogger.info("[touch-input] zoom", {
        operation: "touch_zoom",
        zoom: Number(this.view.zoom.toFixed(2)),
      });
    }, 400);
  }

  /** Where the cursor is on screen (tests, and drawing nothing extra). */
  cursorOnScreen(): { x: number; y: number } | null {
    if (!this.cursor) return null;
    return remoteToScreen(this.view, this.opts.getBox(), this.opts.getRemote(), this.cursor);
  }
}

function clampToRemote(p: { x: number; y: number }, remote: RemoteSize): { x: number; y: number } {
  return {
    x: Math.min(remote.width - 1, Math.max(0, p.x)),
    y: Math.min(remote.height - 1, Math.max(0, p.y)),
  };
}

function points(list: TouchList): TouchPoint[] {
  const out: TouchPoint[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    out.push({ id: t.identifier, x: t.clientX, y: t.clientY });
  }
  return out;
}

function ids(list: TouchList): number[] {
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i].identifier);
  return out;
}
