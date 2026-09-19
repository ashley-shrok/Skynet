/**
 * Phase 120 Plan 06 Task 1 — AppPane iframe wrapper tests.
 *
 * The AppPane is a single-purpose iframe wrapper that mounts inside the
 * pane's leaf renderer for tab.type === "app" (see D-05). It renders the
 * live authenticated web view of an app running on its home box, served
 * under Skynet's own primary origin via the /apps/:hostId/:slug/pane/*
 * reverse-proxy path (Plan 05).
 *
 * Attribute discipline (D-05 + D-20):
 *   - `src` uses encodeURIComponent on BOTH hostId and slug (defensive,
 *     mirrors AppTile.tsx MEDIUM-1 fix pattern).
 *   - NO `sandbox` attribute — the app is fully trusted at the pane level
 *     (same origin, same auth); sandboxing would break the app's own
 *     JavaScript, forms, and cookies.
 *   - `referrerPolicy="no-referrer"` — D-20 discipline: the pane sends NO
 *     signal to the app about which Skynet page opened it.
 *   - `loading="eager"` — the pane is visible immediately on tab open;
 *     lazy would defer first paint unnecessarily.
 *   - `className="h-full w-full border-0"` — fills the leaf; the iframe IS
 *     the entire in-pane view; Skynet draws no chrome around it.
 *   - `title={`App ${slug}`}` — accessibility affordance; iframes need a
 *     title. Reflects the slug (NOT the app's live document.title per D-19).
 *   - `data-*` attributes for downstream test/debug identification.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AppPane } from "./AppPane";

describe("AppPane iframe wrapper (Phase 120 D-05)", () => {
  it("Test 1: renders exactly one <iframe> element", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframes = container.querySelectorAll("iframe");
    expect(iframes.length).toBe(1);
  });

  it("Test 2: iframe src is /apps/1/todo/pane/ (safe inputs)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/apps/1/todo/pane/");
  });

  it("Test 3: slug with space is URL-encoded (T-120-32 mitigation)", () => {
    const { container } = render(
      <AppPane hostId={5} slug="my app" tabId="t2" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/apps/5/my%20app/pane/");
  });

  it("Test 4: slug with forward-slash is URL-encoded (T-120-32 mitigation)", () => {
    const { container } = render(
      <AppPane hostId={5} slug="a/b" tabId="t2" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // "a/b" → "a%2Fb" — cannot break out of the URL path segment.
    expect(iframe?.getAttribute("src")).toBe("/apps/5/a%2Fb/pane/");
  });

  it("Test 5: iframe has NO sandbox attribute (D-05 anti-pattern)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // Sandbox intentionally unset — app is same-origin + trusted at pane level.
    expect(iframe?.getAttribute("sandbox")).toBeNull();
  });

  it("Test 6: iframe has referrerPolicy='no-referrer' (D-20)", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    // D-20 — pane sends NO signal to the app.
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("Test 7: iframe has loading='eager'", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("loading")).toBe("eager");
  });

  it("Test 8: iframe title reflects the slug", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("title")).toBe("App todo");
  });

  it("Test 9: iframe has data-* identification attributes", () => {
    const { container } = render(
      <AppPane hostId={7} slug="notes" tabId="tab-xyz" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("data-app-hostid")).toBe("7");
    expect(iframe?.getAttribute("data-app-slug")).toBe("notes");
    expect(iframe?.getAttribute("data-tab-id")).toBe("tab-xyz");
  });

  it("Test 10: iframe has className 'h-full w-full border-0'", () => {
    const { container } = render(
      <AppPane hostId={1} slug="todo" tabId="t1" isVisible={true} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("class")).toBe("h-full w-full border-0");
  });
});
