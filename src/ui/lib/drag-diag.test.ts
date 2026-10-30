import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_NO_END_MS, DRAG_STALL_MS, __resetDragDiagForTests, installDragDiag } from "./drag-diag";

function fire(type: string, target: EventTarget = window, init: MouseEventInit = {}): void {
  const e = new MouseEvent(type, { bubbles: true, ...init });
  target.dispatchEvent(e);
}

function lines(spy: ReturnType<typeof vi.spyOn>, kind: string): Record<string, unknown>[] {
  return spy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((l: string) => l.startsWith(`[dnd-diag] ${kind} `))
    .map((l: string) => JSON.parse(l.slice(`[dnd-diag] ${kind} `.length)));
}

describe("drag-diag", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let row: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    installDragDiag();
    __resetDragDiagForTests();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    row = document.createElement("div");
    row.className = "pv-row pinned";
    document.body.appendChild(row);
  });

  afterEach(() => {
    row.remove();
    __resetDragDiagForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs start and end with event counts for a healthy drag", () => {
    const accept = (e: Event) => e.preventDefault();
    document.body.addEventListener("dragover", accept);
    fire("dragstart", row);
    vi.advanceTimersByTime(0);
    fire("drag", row);
    fire("dragover", document.body, { cancelable: true });
    fire("dragover", document.body, { cancelable: true });
    fire("dragover", row, { cancelable: true });
    fire("dragend", row);
    document.body.removeEventListener("dragover", accept);
    vi.advanceTimersByTime(DRAG_NO_END_MS);

    expect(lines(info, "start")[0]).toMatchObject({ drag: 1, source: "div.pv-row.pinned", connected: true });
    const end = lines(info, "end")[0];
    expect(end).toMatchObject({ drag: 1, source: "div.pv-row.pinned", lastOver: "div.pv-row.pinned" });
    // The row's dragover bubbles to body, so all three were accepted.
    expect(end.counts).toMatchObject({ drag: 1, dragover: 3, accepted: 3 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts dragovers nobody accepted", () => {
    fire("dragstart", row);
    fire("dragover", row, { cancelable: true });
    fire("dragend", row);
    expect(lines(info, "end")[0].counts).toMatchObject({ dragover: 1, accepted: 0 });
  });

  it("warns stalled when no drag or dragover follows dragstart", () => {
    fire("dragstart", row);
    fire("mousemove", document.body, { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(DRAG_STALL_MS);

    const stalled = lines(warn, "stalled")[0];
    expect(stalled).toMatchObject({ drag: 1, source: "div.pv-row.pinned" });
    expect(stalled.counts).toMatchObject({ drag: 0, dragover: 0, mousemove: 1 });
  });

  it("warns stale-previous when a drag starts before the last one ended", () => {
    fire("dragstart", row);
    fire("dragover", document.body);
    fire("dragstart", row);
    expect(lines(warn, "stale-previous")[0]).toMatchObject({ drag: 1 });
    fire("dragend", row);
    expect(lines(info, "end")[0]).toMatchObject({ drag: 2 });
  });

  it("warns no-end when a drag never finishes", () => {
    fire("dragstart", row);
    fire("drag", row);
    vi.advanceTimersByTime(DRAG_NO_END_MS);
    expect(lines(warn, "no-end")[0]).toMatchObject({ drag: 1 });
    expect(lines(warn, "stalled")).toHaveLength(0);
  });

  it("logs a drop then closes the session on dragend", () => {
    fire("dragstart", row);
    fire("dragover", document.body);
    fire("drop", document.body);
    fire("dragend", row);
    expect(lines(info, "drop")[0]).toMatchObject({ drag: 1, at: "body" });
    expect(lines(info, "end")[0]).toMatchObject({ drag: 1 });
  });

  it("never cancels or stops the app's own drag handlers", () => {
    const seen: string[] = [];
    row.addEventListener("dragstart", (e) => seen.push(`start:${e.defaultPrevented}`));
    document.body.addEventListener("dragover", (e) => seen.push(`over:${e.defaultPrevented}`));
    fire("dragstart", row, { cancelable: true });
    fire("dragover", document.body, { cancelable: true });
    expect(seen).toEqual(["start:false", "over:false"]);
  });
});
