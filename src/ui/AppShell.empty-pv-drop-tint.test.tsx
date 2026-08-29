// ─── AppShell.empty-pv-drop-tint.test.tsx ──────────────────────────────────
// Phase 59 Plan 01 Task 1 — coral tint overlay on empty PrettyView drop
// target (Gap 1) — scaffold-based test suite.
//
// Mirrors the AppShell.split-tree.test.tsx MechanismScaffold pattern (fallback
// authorized in that file's header) — mounting the full AppShell would drag
// in ~30 imports; the load-bearing mechanism is small enough to reproduce in
// a minimal scaffold that mirrors the empty-PV drop wrapper 1:1:
//
//   1. isConvRowDragOver: boolean useState — the tint's on/off state.
//   2. prevEmptyPvVisibleRef: Ref<boolean|null> — zone-change gate for the
//      structured log (mirrors SplitView.tsx:223 prevZoneRef pattern).
//   3. onDragOver — text/plain type-gate + Files exclusion; sets state true
//      + emits `[empty-pv-drop-preview] visible=true …` on transition.
//   4. onDragLeave — text/plain type-gate FIRST + bounding-rect stateless
//      guard (mirror SplitView.tsx:301-305) to prevent flicker on child
//      DOM boundary crossings; sets state false + emits `visible=false` on
//      transition.
//   5. onDrop — clears state FIRST (defensive, idempotent) then emits log.
//   6. useEffect for window-level dragend cleanup — Escape-cancel path
//      (mirror SplitView.tsx:378-381).
//   7. Overlay sibling div with data-testid="empty-pv-drop-preview",
//      pointer-events-none, coral palette (rgba(255, 184, 150, 0.22) fill
//      + 2px solid rgba(255, 184, 150, 0.60) border). Render gate is
//      `isTintActive && splitTreeNull` — architectural exclusion when
//      splitTree !== null (Pane's own overlay owns that state).
//
// Tests (per plan's <behavior> block A-H):
//   A: dragOver with text/plain when splitTree null → overlay rendered.
//   B: dragOver with Files → overlay NOT rendered.
//   C: splitTree !== null + text/plain dragOver → overlay NOT rendered.
//   D: dragOver then drop → overlay present then ABSENT.
//   E: dragOver then window dragend → overlay present then ABSENT.
//   F: dragOver then dragLeave INSIDE bounding rect → overlay STAYS.
//   G: dragOver then dragLeave OUTSIDE bounding rect → overlay ABSENT.
//   H: two consecutive identical dragOvers → console.info called EXACTLY
//      once for the transition (zone-change gate); + drop adds one more log.

import { useEffect, useRef, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, createEvent, act, cleanup } from "@testing-library/react";

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
function dispatchDragLeaveAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = createEvent.dragLeave(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
}

// ─── MechanismScaffold ───────────────────────────────────────────────────────
// Mirrors the empty-PV drop wrapper from AppShell.tsx:2258-2379 — same
// handler shapes, same state/ref pattern, same overlay JSX. simulateSplitTreeNonNull
// hydrates the render-gate exclusion (Test C).

function EmptyPvDropScaffold({
  simulateSplitTreeNonNull = false,
}: {
  simulateSplitTreeNonNull?: boolean;
}) {
  // The scaffold reads splitTree as a plain boolean — the plan's real code
  // uses `splitTree === null` on a SplitNode | null; the scaffold collapses
  // that to a boolean since the tint mechanism only cares about the null
  // check for the render gate + log payload.
  const splitTreeNull = !simulateSplitTreeNonNull;
  const [isConvRowDragOver, setIsConvRowDragOver] = useState(false);
  const prevEmptyPvVisibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    const onDragEnd = () => {
      setIsConvRowDragOver(false);
      if (prevEmptyPvVisibleRef.current !== false) {
        // eslint-disable-next-line no-console
        console.info(
          `[empty-pv-drop-preview] visible=false splitTreeNull=${splitTreeNull}`,
        );
        prevEmptyPvVisibleRef.current = false;
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
        // Mirror AppShell.tsx:2271-2273 existing type-gate verbatim.
        if (!e.dataTransfer.types.includes("text/plain")) return;
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        // Phase 59 Gap 1 tint state — post type-gate so Files drags never trigger.
        setIsConvRowDragOver(true);
        if (prevEmptyPvVisibleRef.current !== true) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] visible=true splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvVisibleRef.current = true;
        }
      }}
      onDragLeave={(e) => {
        // Type-gate FIRST (mirror SplitView.tsx:292).
        if (!e.dataTransfer.types.includes("text/plain")) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const stillInside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (stillInside) return;
        setIsConvRowDragOver(false);
        if (prevEmptyPvVisibleRef.current !== false) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] visible=false splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvVisibleRef.current = false;
        }
      }}
      onDrop={(e) => {
        // Clear FIRST (mirror SplitView.tsx:323-324 — drop always clears).
        setIsConvRowDragOver(false);
        if (prevEmptyPvVisibleRef.current !== false) {
          // eslint-disable-next-line no-console
          console.info(
            `[empty-pv-drop-preview] visible=false splitTreeNull=${splitTreeNull}`,
          );
          prevEmptyPvVisibleRef.current = false;
        }
        // Downstream real handler would then run (payload resolution ladder,
        // setSplitTree, etc.); scaffold stops at the clear.
        if (!e.dataTransfer.types.includes("text/plain")) return;
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
    >
      {isConvRowDragOver && splitTreeNull && (
        <div
          data-testid="empty-pv-drop-preview"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "rgba(255, 184, 150, 0.22)",
            border: "2px solid rgba(255, 184, 150, 0.60)",
            zIndex: 30,
            transition: "opacity 120ms ease",
          }}
        />
      )}
    </div>
  );
}

// Set a known bounding rect on the wrapper for tests F/G. Uses
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

describe("AppShell empty-PV drop-tint mechanism (Phase 59 Plan 01 Gap 1)", () => {
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
    // Real Files drags may or may not include text/plain — mirror the
    // AppShell.tsx:2272 guard: any presence of Files short-circuits.
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
    // NOTE: jsdom DragEvent init drops clientX/Y; must use dispatchDragLeaveAt.
    dispatchDragLeaveAt(wrapper, 300, 300, dt);
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
  });

  it("Test G: dragLeave with clientX/Y OUTSIDE the wrapper's bounding rect clears the overlay", () => {
    const { getByTestId, queryByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    expect(queryByTestId("empty-pv-drop-preview")).not.toBeNull();
    // 50,50 is outside the known rect (left=100).
    dispatchDragLeaveAt(wrapper, 50, 50, dt);
    expect(queryByTestId("empty-pv-drop-preview")).toBeNull();
  });

  it("Test H: two consecutive identical dragOvers emit the [empty-pv-drop-preview] visible=true log EXACTLY once (zone-change gate); drop adds one visible=false log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { getByTestId } = render(<EmptyPvDropScaffold />);
    const wrapper = getByTestId("empty-pv-drop-wrapper");
    const dt = makeDataTransferStub({ "text/plain": "tab-alice-1" });

    fireEvent.dragOver(wrapper, { dataTransfer: dt });
    fireEvent.dragOver(wrapper, { dataTransfer: dt });

    const previewCallsAfterDragOvers = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[empty-pv-drop-preview] "),
    );
    expect(previewCallsAfterDragOvers).toHaveLength(1);
    expect(previewCallsAfterDragOvers[0][0]).toBe(
      "[empty-pv-drop-preview] visible=true splitTreeNull=true",
    );

    fireEvent.drop(wrapper, { dataTransfer: dt });

    const previewCallsAfterDrop = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[empty-pv-drop-preview] "),
    );
    expect(previewCallsAfterDrop).toHaveLength(2);
    expect(previewCallsAfterDrop[1][0]).toBe(
      "[empty-pv-drop-preview] visible=false splitTreeNull=true",
    );
  });
});
