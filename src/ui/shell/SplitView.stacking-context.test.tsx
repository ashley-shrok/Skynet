// ─── SplitView.stacking-context.test.tsx ─────────────────────────────────────
// Quick task 260829-fh3 — Regression test guarding the CSS stacking-context
// escape fix on the Pane outer wrapper at src/ui/shell/SplitView.tsx:~400.
//
// Why this file exists
// --------------------
// The 2026-08-28 UAT trace captured under skynet-patches.md #517 handoff
// showed PrettyView's high-z chrome — IdentityBadge (z-[101] at
// src/ui/features/terminal/IdentityBadge.tsx:90), DropOverlay (z-[95]),
// SessionHoldingOverlay (z-[99]) and the composebox close button — visually
// escaping the Pane wrapper and painting on top of an RDP surface after a
// non-split-tree RDP session was clicked while a multi-view split was
// active. Root cause: the Pane outer div did NOT establish a CSS stacking
// context, so its descendants' large z-index values were compared against
// the AppShell tree — where the normal-view container's zIndex:10
// (src/ui/AppShell.tsx:2552-2555) is supposed to cover the split when the
// active tab lives outside the split tree, but loses to any child z ≥ 11
// with no isolating ancestor.
//
// The fix: add the Tailwind `isolate` utility (v4 shorthand for
// `isolation: isolate`) to the Pane outer wrapper's className. These tests
// prevent a future refactor from silently dropping that token.
//
// Guard shape (Test C): match `isolate` as a WHITESPACE-DELIMITED standalone
// class. A naive `toContain("isolate")` would also pass on `isolation-foo`
// or `isolate-bar`, neither of which produces the same CSS.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SplitView } from "./SplitView";
import type { SplitNode } from "@/lib/split-tree";
import type { Tab } from "@/types/ui-types";

// Match the passthrough react-i18next mock used at SplitView.test.tsx:37-42.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Match the tabIcon stub used at SplitView.test.tsx:46-48.
vi.mock("@/shell/tabUtils", () => ({
  tabIcon: (_type: string) => "ICON",
}));

// ─── fixtures (mirror SplitView.test.tsx:52-71) ─────────────────────────────

function makeTab(id: string, label: string): Tab {
  return {
    id,
    instanceId: id,
    type: "terminal",
    label,
    openedAt: 0,
    targetTmuxSession: null,
  } as unknown as Tab;
}

const tabA = makeTab("aaa", "Alpha");
const tabB = makeTab("bbb", "Bravo");

const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });
const split = (
  direction: "horizontal" | "vertical",
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: "split", direction, children: [a, b] });

beforeEach(() => {
  cleanup();
});

// ─── helper ─────────────────────────────────────────────────────────────────

// Walk from a [data-tab-id] descendant up to the Pane's outer div.
// Uses the loosened substring "flex flex-col" so this walk works whether
// the source className is `relative flex flex-col …` or the post-fix
// `relative isolate flex flex-col …` — the walk is a fixture-finder, not
// a token assertion. The actual `isolate` assertion happens after the
// walk finds the wrapper.
function findPaneOuter(from: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = from.parentElement;
  while (cur && !cur.className.includes("flex flex-col")) {
    cur = cur.parentElement;
  }
  if (!cur) throw new Error("Pane outer div not found");
  return cur;
}

// Standalone-class guard: `isolate` must appear delimited by whitespace or
// string boundary. Prevents accidental matches on `isolation-foo` or the
// like.
const ISOLATE_STANDALONE = /(?:^|\s)isolate(?:\s|$)/;

// ─── tests ──────────────────────────────────────────────────────────────────

describe("SplitView — Pane wrapper stacking context (quick-260829-fh3)", () => {
  it("Test A: single leaf — Pane outer wrapper className contains `isolate`", () => {
    const { container } = render(
      <SplitView
        tabs={[tabA]}
        splitTree={leaf("aaa")}
        focusedTabId="aaa"
        onTerminalResize={() => {}}
        onPaneContentRef={() => {}}
      />,
    );
    const content = container.querySelector("[data-tab-id]") as HTMLElement;
    expect(content).not.toBeNull();
    const paneOuter = findPaneOuter(content);
    expect(paneOuter.className).toMatch(ISOLATE_STANDALONE);
  });

  it("Test B: horizontal split — BOTH Pane outer wrappers carry `isolate`", () => {
    const { container } = render(
      <SplitView
        tabs={[tabA, tabB]}
        splitTree={split("horizontal", leaf("aaa"), leaf("bbb"))}
        focusedTabId="aaa"
        onTerminalResize={() => {}}
        onPaneContentRef={() => {}}
      />,
    );
    const contents = container.querySelectorAll("[data-tab-id]");
    expect(contents.length).toBe(2);
    for (const content of Array.from(contents)) {
      const paneOuter = findPaneOuter(content as HTMLElement);
      expect(paneOuter.className).toMatch(ISOLATE_STANDALONE);
    }
  });

  it("Test C: `isolate` appears as a standalone class token, not embedded", () => {
    // Same setup as Test A. The point of this test is the regex guard:
    // if a future edit accidentally writes `isolation-something` or
    // `isolate-foo`, `toContain("isolate")` would still pass but the CSS
    // stacking context would NOT be established. The whitespace-delimited
    // match catches that.
    const { container } = render(
      <SplitView
        tabs={[tabA]}
        splitTree={leaf("aaa")}
        focusedTabId="aaa"
        onTerminalResize={() => {}}
        onPaneContentRef={() => {}}
      />,
    );
    const content = container.querySelector("[data-tab-id]") as HTMLElement;
    const paneOuter = findPaneOuter(content);
    expect(paneOuter.className).toMatch(ISOLATE_STANDALONE);
    // Belt-and-suspenders: the raw substring "isolation-" must not appear
    // — that would indicate the Tailwind class was mistyped as e.g.
    // `isolation-isolate` (which does exist as a longhand utility but is
    // not the shorthand the fix mandated and not the token this repo
    // uses at SessionHoldingOverlay.tsx:133 et al).
    expect(paneOuter.className).not.toMatch(/isolation-/);
  });
});
