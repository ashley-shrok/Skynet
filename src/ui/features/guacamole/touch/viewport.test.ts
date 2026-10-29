import { describe, it, expect } from "vitest";
import {
  FITTED_VIEW,
  MAX_ZOOM,
  clampView,
  fitScale,
  followPoint,
  panBy,
  remoteToScreen,
  screenToRemote,
  zoomAt,
} from "./viewport";

// A phone held upright showing a 1280×720 desktop: 390 wide, 700 tall box.
const box = { left: 0, top: 50, width: 390, height: 700 };
const remote = { width: 1280, height: 720 };

describe("viewport", () => {
  it("fits the whole desktop at zoom 1, centred", () => {
    expect(fitScale(box, remote)).toBeCloseTo(390 / 1280);
    const c = remoteToScreen(FITTED_VIEW, box, remote, { x: 640, y: 360 });
    expect(c.x).toBeCloseTo(195);
    expect(c.y).toBeCloseTo(400);
  });

  it("screen and remote positions round-trip", () => {
    const v = { zoom: 2.5, tx: -100, ty: 40 };
    const r = screenToRemote(v, box, remote, { x: 120, y: 300 });
    const p = remoteToScreen(v, box, remote, r);
    expect(p.x).toBeCloseTo(120);
    expect(p.y).toBeCloseTo(300);
  });

  it("zooming keeps the spot under the fingers in place", () => {
    const before = screenToRemote(FITTED_VIEW, box, remote, { x: 300, y: 410 });
    const v = zoomAt(FITTED_VIEW, box, remote, 4, 300, 410);
    expect(v.zoom).toBe(4);
    const after = remoteToScreen(v, box, remote, before);
    expect(after.x).toBeCloseTo(300);
    expect(after.y).toBeCloseTo(410);
  });

  it("zoom stays between fitted and four times", () => {
    expect(zoomAt(FITTED_VIEW, box, remote, 0.2, 100, 100).zoom).toBe(1);
    expect(zoomAt(FITTED_VIEW, box, remote, 50, 100, 100).zoom).toBe(MAX_ZOOM);
  });

  it("a fitted picture can't be moved off centre", () => {
    expect(panBy(FITTED_VIEW, box, remote, 80, -80)).toEqual(FITTED_VIEW);
  });

  it("a zoomed picture moves only as far as its own edge", () => {
    const v = clampView({ zoom: 2, tx: 10_000, ty: 0 }, box, remote);
    // Picture is 780 wide in a 390 box: its centre can move ±195.
    expect(v.tx).toBeCloseTo(195);
  });

  it("follows a point pushed past the edge margin", () => {
    const v = { zoom: 4, tx: 0, ty: 0 };
    // Right edge of the desktop is far off screen at zoom 4.
    const next = followPoint(v, box, remote, { x: 1000, y: 360 }, 24);
    const p = remoteToScreen(next, box, remote, { x: 1000, y: 360 });
    expect(p.x).toBeCloseTo(390 - 24);
  });

  it("leaves the view alone when the point is already inside", () => {
    const v = { zoom: 2, tx: 0, ty: 0 };
    expect(followPoint(v, box, remote, { x: 640, y: 360 }, 24)).toEqual(v);
  });
});
