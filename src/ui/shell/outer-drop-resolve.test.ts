import { describe, it, expect, vi } from "vitest";
import { resolveOuterDrop } from "./outer-drop-resolve";

type Badge = { tabId?: string; dragId?: string | null; descriptor?: unknown };

function dt(entries: Record<string, string>) {
  return { getData: (t: string) => entries[t] ?? "" };
}

function resolvers(over: Partial<Parameters<typeof resolveOuterDrop<Badge>>[1]> = {}) {
  return {
    resolveRow: vi.fn(() => null as string | null),
    isLocalTab: vi.fn(() => false),
    resolveBadge: vi.fn(() => null as string | null),
    ...over,
  };
}

describe("resolveOuterDrop", () => {
  it("row payload wins", () => {
    const r = resolvers({ resolveRow: vi.fn(() => "row-tab") });
    const out = resolveOuterDrop<Badge>(
      dt({ "application/x-skynet-row": JSON.stringify({ id: "x" }), "text/plain": "x" }),
      r,
    );
    expect(out).toEqual({ tabId: "row-tab", acceptDragId: null, via: "row" });
    expect(r.resolveBadge).not.toHaveBeenCalled();
  });

  it("same-window badge resolves by local tabId without echoing an accept", () => {
    const r = resolvers({ isLocalTab: vi.fn((id: string) => id === "t1") });
    const out = resolveOuterDrop<Badge>(
      dt({
        "text/plain": "t1",
        "application/x-skynet-badge": JSON.stringify({ tabId: "t1", dragId: "d1" }),
      }),
      r,
    );
    expect(out).toEqual({ tabId: "t1", acceptDragId: null, via: "local" });
    expect(r.resolveBadge).not.toHaveBeenCalled();
  });

  it("cross-window badge (source tab unknown here) opens via the descriptor and returns the dragId", () => {
    const resolveBadge = vi.fn(() => "fresh-tab");
    const r = resolvers({ resolveBadge });
    const payload = {
      tabId: "other-window-tab",
      dragId: "d42",
      descriptor: { tabType: "app", app: { hostId: 3, slug: "todo" } },
    };
    const out = resolveOuterDrop<Badge>(
      dt({ "text/plain": "other-window-tab", "application/x-skynet-badge": JSON.stringify(payload) }),
      r,
    );
    expect(out).toEqual({ tabId: "fresh-tab", acceptDragId: "d42", via: "badge" });
    expect(resolveBadge).toHaveBeenCalledWith(payload);
  });

  it("unresolvable badge (e.g. host not in this window) aborts with nothing", () => {
    const out = resolveOuterDrop<Badge>(
      dt({ "text/plain": "x", "application/x-skynet-badge": JSON.stringify({ tabId: "x" }) }),
      resolvers(),
    );
    expect(out).toEqual({ tabId: null, acceptDragId: null, via: null });
  });

  it("malformed badge JSON aborts cleanly", () => {
    const out = resolveOuterDrop<Badge>(
      dt({ "text/plain": "x", "application/x-skynet-badge": "{nope" }),
      resolvers({ resolveBadge: vi.fn(() => "should-not") }),
    );
    expect(out.tabId).toBeNull();
  });

  it("cross-window badge without a dragId still opens, just no accept to echo", () => {
    const out = resolveOuterDrop<Badge>(
      dt({ "application/x-skynet-badge": JSON.stringify({ tabId: "x" }) }),
      resolvers({ resolveBadge: vi.fn(() => "fresh") }),
    );
    expect(out).toEqual({ tabId: "fresh", acceptDragId: null, via: "badge" });
  });
});
