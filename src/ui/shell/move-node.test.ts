import { describe, it, expect, vi, afterEach } from "vitest";
import { moveNodeInto } from "./move-node";

type WithMove = HTMLElement & { moveBefore?: (n: Node, c: Node | null) => void };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("moveNodeInto", () => {
  it("first placement of a detached node appends", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const moveBefore = vi.fn();
    (target as WithMove).moveBefore = moveBefore;
    const node = document.createElement("div");
    expect(moveNodeInto(target, node)).toBe("appended");
    expect(moveBefore).not.toHaveBeenCalled();
    expect(node.parentElement).toBe(target);
  });

  it("an already-placed node moves in place when the browser supports it", () => {
    const from = document.createElement("div");
    const target = document.createElement("div");
    document.body.append(from, target);
    const node = document.createElement("div");
    from.appendChild(node);
    const moveBefore = vi.fn((n: Node) => target.appendChild(n));
    (target as WithMove).moveBefore = moveBefore;
    expect(moveNodeInto(target, node)).toBe("moved-in-place");
    expect(moveBefore).toHaveBeenCalledWith(node, null);
    expect(node.parentElement).toBe(target);
  });

  it("no moveBefore → appends (today's behavior)", () => {
    const from = document.createElement("div");
    const target = document.createElement("div");
    document.body.append(from, target);
    const node = document.createElement("div");
    from.appendChild(node);
    (target as WithMove).moveBefore = undefined;
    expect(moveNodeInto(target, node)).toBe("appended");
    expect(node.parentElement).toBe(target);
  });

  it("moveBefore throwing falls back to appendChild instead of leaving the node unplaced", () => {
    const from = document.createElement("div");
    const target = document.createElement("div");
    document.body.append(from, target);
    const node = document.createElement("div");
    from.appendChild(node);
    (target as WithMove).moveBefore = () => {
      throw new DOMException("nope", "HierarchyRequestError");
    };
    expect(moveNodeInto(target, node)).toBe("appended");
    expect(node.parentElement).toBe(target);
  });

  it("detached target appends", () => {
    const from = document.createElement("div");
    document.body.appendChild(from);
    const node = document.createElement("div");
    from.appendChild(node);
    const target = document.createElement("div");
    const moveBefore = vi.fn();
    (target as WithMove).moveBefore = moveBefore;
    expect(moveNodeInto(target, node)).toBe("appended");
    expect(moveBefore).not.toHaveBeenCalled();
  });
});
