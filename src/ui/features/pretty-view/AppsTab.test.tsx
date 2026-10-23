/**
 * convo-scoped apps: the identity modal's Apps tab lists the conversation's
 * own apps; a row click closes the modal and opens the app; each row's ⋮ has
 * exactly one item, Move to sidebar, which asks the agent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppsTab, conversationAppsFor } from "./AppsTab";
import { OPEN_APP_EVENT, type OpenAppDetail } from "../apps/app-link";
import { _resetPromoteRequestsForTesting } from "@/state/app-promote-requests";
import type { AppState } from "@/api/fleet-status-types";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/apps-promote-api", () => ({
  requestAppPromotion: vi.fn().mockResolvedValue({ ok: true }),
}));
import { requestAppPromotion } from "@/api/apps-promote-api";

const base: AppState = {
  hostId: "6",
  slug: "tally",
  title: "Tally",
  description: "counts things",
  port: 9505,
  hasIcon: false,
  createdAtMs: 0,
  isHealthy: true,
  healthMessage: null,
  owner: "alpha",
};

beforeEach(() => _resetPromoteRequestsForTesting());
afterEach(() => cleanup());

describe("conversationAppsFor", () => {
  it("keeps only this identity's apps on this host", () => {
    const apps = [
      base,
      { ...base, slug: "side", owner: null },
      { ...base, slug: "other", owner: "beta" },
      { ...base, slug: "elsewhere", hostId: "7" },
    ];
    expect(conversationAppsFor(apps, 6, "alpha").map((a) => a.slug)).toEqual(["tally"]);
    expect(conversationAppsFor(apps, 6, "ALPHA").map((a) => a.slug)).toEqual(["tally"]);
  });
});

describe("AppsTab", () => {
  it("row click closes the modal and opens the app", () => {
    const onClose = vi.fn();
    const seen: OpenAppDetail[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent<OpenAppDetail>).detail);
    window.addEventListener(OPEN_APP_EVENT, h);
    try {
      render(<AppsTab apps={[base]} onClose={onClose} />);
      expect(screen.getByText("counts things")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open Tally" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([{ hostId: 6, slug: "tally", title: "Tally" }]);
    } finally {
      window.removeEventListener(OPEN_APP_EVENT, h);
    }
  });

  it("the row menu holds only Move to sidebar, which asks the agent", async () => {
    render(<AppsTab apps={[base]} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByTestId("identity-apps-row-kebab"));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual(["Move to sidebar"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to sidebar" }));
    expect(requestAppPromotion).toHaveBeenCalledWith(6, "tally");
  });
});
