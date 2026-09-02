// ─── AppShell.empty-pv-drop-tint.test.tsx ──────────────────────────────────
// Phase 59 Plan 01 Task 1 — coral tint overlay on empty PrettyView drop
// target (Gap 1) — scaffold-based test suite.
//
// inline-260902 (identity-badge-drop-preview): scaffold widened from
// isConvRowDragOver: boolean to convRowDragZone: DropEdge | "full" | null so
// the preview reflects the zone the drop will actually route to. Log format
// changed from `visible=true|false` to `zone=<edge|full|none>` alongside.
//
// Mirrors the AppShell.split-tree.test.tsx MechanismScaffold pattern (fallback
// authorized in that file's header) — mounting the full AppShell would drag
// in ~30 imports; the load-bearing mechanism is small enough to reproduce in
// a minimal scaffold that mirrors the empty-PV drop wrapper 1:1:
//
//   1. convRowDragZone: DropEdge | "full" | null useState — the zone state.
//   2. prevEmptyPvZoneRef: Ref<zone|null> — zone-change gate for the
//      structured log (mirrors SplitView.tsx:223 prevZoneRef pattern).
//   3. onDragOver — text/plain type-gate + Files exclusion; computes the
//      zone based on activeIsSession + best-effort badge self-drop check;
//      emits `[empty-pv-drop-preview] zone=<edge|full> …` on transition.
//   4. onDragLeave — text/plain type-gate FIRST + bounding-rect stateless
//      guard (mirror SplitView.tsx:301-305) to prevent flicker on child
//      DOM boundary crossings; sets state null + emits `zone=none` on
//      transition.
//   5. onDrop — clears state FIRST (defensive, idempotent) then emits log.
//   6. useEffect for window-level dragend cleanup — Escape-cancel path
//      (mirror SplitView.tsx:378-381).
//   7. Overlay sibling div with data-testid="empty-pv-drop-preview",
//      data-zone attribute reflects the state, geometry reflects the zone
//      (whole-body for "full", half-body edge rect for DropEdge), coral
//      palette (rgba(255, 184, 150, 0.22) fill + 2px solid
//      rgba(255, 184, 150, 0.60) border). Render gate is
//      `zone !== null && splitTreeNull` — architectural exclusion when
//      splitTree !== null (Pane's own overlay owns that state).
//
// Tests:
//   A: dragOver with text/plain when splitTree null → overlay rendered.
//   B: dragOver with Files → overlay NOT rendered.
//   C: splitTree !== null + text/plain dragOver → overlay NOT rendered.
//   D: dragOver then drop → overlay present then ABSENT.
//   E: dragOver then window dragend → overlay present then ABSENT.
//   F: dragOver then dragLeave INSIDE bounding rect → overlay STAYS.
//   G: dragOver then dragLeave OUTSIDE bounding rect → overlay ABSENT.
//   H: two consecutive identical dragOvers emit ONE zone=<X> log; drop adds
//      one zone=none log.
//   I (inline-260902): activeIsSession=false → zone="full" whole-body.
//   J (inline-260902): activeIsSession=true + cursor near LEFT edge →
//      zone="left", geometry is left half (width 50%, left 0).
//   K (inline-260902): activeIsSession=true + cursor near RIGHT edge →
//      zone="right", geometry is right half (width 50%, left 50%).
//   L (inline-260902): activeIsSession=true + badge payload sourceTabId ===
//      activeTab.id → zone="full" (self-drop preview short-circuit).

import { useEffect, useRef, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, createEvent, act, cleanup } from "@testing-library/react";
import { computeNearestEdge, overlayGeometryForZone } from "@/shell/SplitView";
import type { DropEdge } from "@/lib/split-tree";

// Helper: build a stub DataTransfer with a Map-backed store. `types` reflects
// the keys, so dragover code that inspects types works. `getData` returns ""
// for missing keys (matches real DataTransfer semantics). Mirrors the shape
// established in PrettyConversationsPanel.test.tsx:4078-4090.
function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types() {
      return Array.from(store.keys());
    },
  };
}

// jsdom's DragEvent init object does NOT honor clientX/clientY passed via the
// constructor, so `fireEvent.dragLeave(el, { clientX, clientY })` sets both
// to 0. Mirror SplitView.test.tsx:448-461 pattern: build via `createEvent.*`
// then Object.defineProperty for clientX/Y, then dispatch via fireEvent(el, evt).
function dispatchDragEventAt(
  kind: "dragOver" | "dragLeave" | "drop",
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt =
    kind === "dragOver"
      ? createEvent.dragOver(el, { dataTransfer: dt })
      : kind === "dragLeave"
      ? createEvent.dragLeave(el, { dataTransfer: dt })
      : createEvent.drop(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
}

// ─── MechanismScaffold ───────────────────────────────────────────────────────
// Mirrors the empty-PV drop wrapper from AppShell.tsx — same handler shapes,
// same state/ref pattern, same overlay JSX.
//
// simulateSplitTreeNonNull hydrates the render-gate exclusion (Test C).
// activeSessionTabId sets the "active tab is a real session" branch: when
// non-null the drop-would-insertAtEdge branch fires (edge-zoned preview);
// when null, drop-would-replace branch fires (whole-body preview).

function EmptyPvDropScaffold({
  simulateSplitTreeNonNull = false,
  activeSessionTabId = null as string | null,
}: {
  simulateSplitTreeNonNull?: boolean;
  activeSessionTabId?: string | null;
}) {
  const splitTreeNull = !simulateSplitTreeNonNull;
  const [convRowDragZone, setConvRowDragZone] = useState<
    DropEdge | "full" | null
  >(null);
  const prevEmptyPvZoneRef = useRef<DropEdge | "full" | null>(null);

  useEffect(() => {
    const onDragEnd = () => {
      setConvRowDragZone(null);
      if (prevEmptyPvZoneRef.current !== null) {
        // eslint-disable-next-line no-console
        console.info(
          `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTreeNull}`,
        );
        prevEmptyPvZoneRef.current = null;
      }
    };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [splitTreeNull]);

  return (
    <div
      data-testid="empty-pv-drop-wrapper"
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("text/plain")) return;
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const activeIsSession = activeSessionTabId !== null;
        let wouldReplace = !activeIsSession;
        if (!wouldReplace && activeSessionTabId !== null) {
          const badgeJson = e.dataTransfer.getData(
            "application/x-skynet-badge",
          );
          if (badgeJson) {
            try {
              const parsed = JSON.parse(badgeJson) as { tabId?: unknown };
              if (
                typeof parsed?.tabId === "string" &&
                parsed.tabId === activeSessionTabId
              ) {
                wouldReplace = true;
              }
            } catch {
              /* fall through — best-effort */
            }
          }
        }
        const zone: DropEdge | "full" = wouldReplace
          ? "full"
          : computeNearestEdge(rect, e.clientX, e.clientY);
        setConvRowDragZone((prev) => (prev === zone ? prev : zone));
        if (prevEmptyPvZoneRef.current !== zone) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] zone=${zone} splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvZoneRef.current = zone;
        }
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("text/plain")) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const stillInside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (stillInside) return;
        setConvRowDragZone(null);
        if (prevEmptyPvZoneRef.current !== null) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvZoneRef.current = null;
        }
      }}
      onDrop={(e) => {
        setConvRowDragZone(null);
        if (prevEmptyPvZoneRef.current !== null) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvZoneRef.current = null;
        }
        if (!e.dataTransfer.types.includes("text/plain")) return;
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
    >
      {convRowDragZone !== null && splitTreeNull && (
        <div
          data-testid="empty-pv-drop-preview"
          data-zone={convRowDragZone}
          className="absolute pointer-events-none"
          style={(() => {
            const geom =
              convRowDragZone === "full"
                ? { left: 0, top: 0, width: "100%", height: "100%" }
                : (() => {
                    const g = overlayGeometryForZone(convRowDragZone, {
                      left: 0,
                      top: 0,
                      right: 100,
                      bottom: 100,
                      width: 100,
                      height: 100,
                    });
                    return {
                      left: `${g.left}%`,
                      top: `${g.top}%`,
                      width: `${g.width}%`,
                      height: `${g.height}%`,
                    };
                  })();
            return {
              ...geom,
              background: "rgba(255, 184, 150, 0.22)",
              border: "2px solid rgba(255, 184, 150, 0.60)",
              zIndex: 30,
              transition: "opacity 120ms ease",
            };
          })()}
        />
      )}
    </div>
  );
}

// Set a known bounding rect on the wrapper for tests F/G/J/K. Uses
// HTMLElement.prototype override in beforeEach + restore in afterEach.
const KNOWN_RECT: DOMRect = {
  left: 100,
  top: 100,
  right: 500,
  bottom: 500,
  x: 100,
  y: 100,
  width: 400,
  height: 400,
  toJSON() {
    return this;
  },
};

let originalGetBoundingClientRect: () => DOMRect;

beforeEach(() => {
  cleanup();
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return KNOWN_RECT;
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.restoreAllMocks();
});

describe("AppShell empty-PV drop-tint mechanism (Phase 59 Plan 01 Gap 1 + inline-260902 zone-aware)", () => {
  it("Test A: dragOver with text/plain when splitTree === null renders the coral overlay", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
  });

  it("Test B: dragOver with Files does NOT render the coral overlay (Files gate)", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({
      "text/plain": "spurious-text",
      "Files": "",
    });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test C: dragOver with text/plain when splitTree !== null does NOT render the overlay (Pane owns that state)", () => {
    const { getByTestId, queryByTestId } = render(
      <EmptyPvDropScaffold simulateSplitTreeNonNull />,
    );
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test D: drop clears the overlay immediately (mirror SplitView.tsx:323)", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
    fireEvent.drop(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test E: window-level dragend clears the overlay (Escape-cancel path)", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test F: dragLeave with clientX/Y INSIDE the wrapper's bounding rect does NOT clear (child-boundary crossing guard)", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
    // KNOWN_RECT is left=100 top=100 right=500 bottom=500 — 300,300 is inside.
    dispatchDragEventAt("dragLeave", wrapper, 300, 300, dt);
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
  });

  it("Test G: dragLeave with clientX/Y OUTSIDE the wrapper's bounding rect clears the overlay", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
    dispatchDragEventAt("dragLeave", wrapper, 50, 50, dt);
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test H: two consecutive identical dragOvers emit the [empty-pv-drop-preview] zone log EXACTLY once (zone-change gate); drop adds one zone=none log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { getByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });

    // Dispatch at a fixed cursor position (300,300 = center of KNOWN_RECT)
    // twice — same zone both times, so log fires once.
    dispatchDragEventAt("dragOver", wrapper, 300, 300, dt);
    dispatchDragEventAt("dragOver", wrapper, 300, 300, dt);

    const previewCallsAfterDragOvers = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[empty-pv-drop-preview] "),
    );
    expect(previewCallsAfterDragOvers).toHaveLength(1);
    expect(previewCallsAfterDragOvers[0][0]).toBe(
      "[empty-pv-drop-preview] zone=full splitTreeNull=true",
    );

    fireEvent.drop(wrapper, { dataTransfer: dt });

    const previewCallsAfterDrop = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[empty-pv-drop-preview] "),
    );
    expect(previewCallsAfterDrop).toHaveLength(2);
    expect(previewCallsAfterDrop[1][0]).toBe(
      "[empty-pv-drop-preview] zone=none splitTreeNull=true",
    );
  });

  // ─── inline-260902 (identity-badge-drop-preview) new tests ─────────────
  it("Test I (inline-260902): activeIsSession=false → zone='full' whole-body geometry", () => {
    const { getByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    // Cursor near left edge — but activeIsSession is false so drop replaces
    // whole tree with dropped leaf; preview must be whole-body ("full").
    dispatchDragEventAt("dragOver", wrapper, 120, 300, dt);
    const overlay = getByTestId("empty-pv-drop-preview");
    expect(overlay.getAttribute("data-zone")).toBe("full");
    expect(overlay.style.width).toBe("100%");
    expect(overlay.style.height).toBe("100%");
    expect(overlay.style.left).toBe("0px"); // 0 as number in style → "0px"
    expect(overlay.style.top).toBe("0px");
  });

  it("Test J (inline-260902): activeIsSession=true + cursor near LEFT edge → zone='left', left-half geometry (50% width, left 0)", () => {
    const { getByTestId } = render(
      <EmptyPvDropScaffold activeSessionTabId="tab-active-42" />,
    );
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    // KNOWN_RECT: left=100 right=500 top=100 bottom=500.
    // (120, 300): dLeft=20, dRight=380, dTop=200, dBottom=200 → nearest=left.
    dispatchDragEventAt("dragOver", wrapper, 120, 300, dt);
    const overlay = getByTestId("empty-pv-drop-preview");
    expect(overlay.getAttribute("data-zone")).toBe("left");
    expect(overlay.style.left).toBe("0%");
    expect(overlay.style.top).toBe("0%");
    expect(overlay.style.width).toBe("50%");
    expect(overlay.style.height).toBe("100%");
  });

  it("Test K (inline-260902): activeIsSession=true + cursor near RIGHT edge → zone='right', right-half geometry (50% width, left 50%)", () => {
    const { getByTestId } = render(
      <EmptyPvDropScaffold activeSessionTabId="tab-active-42" />,
    );
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    // (480, 300): dLeft=380, dRight=20, dTop=200, dBottom=200 → nearest=right.
    dispatchDragEventAt("dragOver", wrapper, 480, 300, dt);
    const overlay = getByTestId("empty-pv-drop-preview");
    expect(overlay.getAttribute("data-zone")).toBe("right");
    expect(overlay.style.left).toBe("50%");
    expect(overlay.style.top).toBe("0%");
    expect(overlay.style.width).toBe("50%");
    expect(overlay.style.height).toBe("100%");
  });

  it("Test L (inline-260902): activeIsSession=true + badge payload sourceTabId === activeTabId → zone='full' (self-drop preview short-circuit)", () => {
    const { getByTestId } = render(
      <EmptyPvDropScaffold activeSessionTabId="tab-active-42" />,
    );
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    // Badge drag of the active session onto itself — drop would be a no-op
    // (droppedLeaf === activeLeaf), so preview must be whole-body not edge.
    const dt = makeDataTransferStub({
      "text/plain": "tab-active-42",
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-active-42" }),
    });
    // Even with cursor at the left edge (would otherwise pick "left"),
    // self-drop short-circuits to "full".
    dispatchDragEventAt("dragOver", wrapper, 120, 300, dt);
    const overlay = getByTestId("empty-pv-drop-preview");
    expect(overlay.getAttribute("data-zone")).toBe("full");
    expect(overlay.style.width).toBe("100%");
  });
});
