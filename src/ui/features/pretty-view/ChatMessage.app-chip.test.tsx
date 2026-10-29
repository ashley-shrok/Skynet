/**
 * convo-scoped apps: app pane links in an agent's message render as app chips.
 * In-process flow: an app is known to the store → the agent links it → the
 * chip shows its title → clicking asks the shell to open it (OPEN_APP_EVENT,
 * the same open a sidebar tile click does) → dragging carries the sidebar
 * tile's drag payload so the split view accepts it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { publishAppSnapshot, __resetForTest as resetAppTiles } from "@/state/app-tiles-store";
import { APP_TILE_MIME, OPEN_APP_EVENT, parseSkynetAppUrl, type OpenAppDetail } from "../apps/app-link";
import type { AppState } from "@/api/fleet-status-types";

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({ play: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn() })),
}));
const mobile = { value: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const ORIGIN = window.location.origin;

const tally: AppState = {
  hostId: "6",
  slug: "tally",
  title: "Tally Board",
  description: "counts things",
  port: 9505,
  hasIcon: false,
  createdAtMs: 0,
  isHealthy: true,
  healthMessage: null,
  owner: "alpha",
};

function renderMessage(content: string) {
  return render(<ChatMessage role="assistant" eventId="e1" content={content} onOpenEditor={vi.fn()} />);
}

beforeEach(() => {
  mobile.value = false;
  resetAppTiles();
  publishAppSnapshot([tally]);
});
afterEach(() => {
  cleanup();
  resetAppTiles();
});

describe("parseSkynetAppUrl", () => {
  it("accepts same-origin and root-relative pane links", () => {
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/6/tally/pane/`)).toEqual({ hostId: 6, slug: "tally" });
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/6/tally/pane`)).toEqual({ hostId: 6, slug: "tally" });
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/6/tally/pane/settings?x=1`)).toEqual({ hostId: 6, slug: "tally" });
    expect(parseSkynetAppUrl("/apps/12/my-app/pane/")).toEqual({ hostId: 12, slug: "my-app" });
  });
  it("rejects other origins and other shapes", () => {
    expect(parseSkynetAppUrl("https://attacker.tld/apps/6/tally/pane/")).toBeNull();
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/6/tally`)).toBeNull();
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/0/tally/pane/`)).toBeNull();
    expect(parseSkynetAppUrl(`${ORIGIN}/apps/6/Bad_Slug/pane/`)).toBeNull();
    expect(parseSkynetAppUrl(`${ORIGIN}/file/harbor/home/x.md`)).toBeNull();
    expect(parseSkynetAppUrl(undefined)).toBeNull();
  });
});

describe("ChatMessage — app chip", () => {
  it("renders a known app as a chip with its title", () => {
    const { container } = renderMessage(`Here you go: [the board](${ORIGIN}/apps/6/tally/pane/)`);
    const chip = container.querySelector("[data-app-chip]") as HTMLAnchorElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("Tally Board");
    expect(chip.getAttribute("data-app-chip-known")).toBe("true");
    expect(chip.getAttribute("target")).toBeNull();
  });

  it("clicking the chip asks the shell to open the app", () => {
    const seen: OpenAppDetail[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent<OpenAppDetail>).detail);
    window.addEventListener(OPEN_APP_EVENT, onOpen);
    try {
      renderMessage(`[board](${ORIGIN}/apps/6/tally/pane/)`);
      fireEvent.click(screen.getByRole("link", { name: /Tally Board/ }));
      expect(seen).toEqual([{ hostId: 6, slug: "tally", title: "Tally Board" }]);
    } finally {
      window.removeEventListener(OPEN_APP_EVENT, onOpen);
    }
  });

  it("dragging the chip carries the sidebar tile payload (desktop)", () => {
    const { container } = renderMessage(`[board](${ORIGIN}/apps/6/tally/pane/)`);
    const chip = container.querySelector("[data-app-chip]") as HTMLElement;
    expect(chip.getAttribute("draggable")).toBe("true");
    const data: Record<string, string> = {};
    fireEvent.dragStart(chip, {
      dataTransfer: {
        clearData: () => {},
        setData: (k: string, v: string) => (data[k] = v),
        effectAllowed: "",
      },
    });
    expect(JSON.parse(data[APP_TILE_MIME])).toEqual({ hostId: 6, slug: "tally", title: "Tally Board" });
  });

  it("isn't draggable on a phone", () => {
    mobile.value = true;
    const { container } = renderMessage(`[board](${ORIGIN}/apps/6/tally/pane/)`);
    expect((container.querySelector("[data-app-chip]") as HTMLElement).getAttribute("draggable")).toBeNull();
  });

  it("an unknown app still renders as a chip, named by its slug", () => {
    const { container } = renderMessage(`[old](${ORIGIN}/apps/6/gone-app/pane/)`);
    const chip = container.querySelector("[data-app-chip]") as HTMLElement;
    expect(chip.getAttribute("data-app-chip-known")).toBe("false");
    expect(chip.textContent).toContain("gone-app");
  });

  it("a sidebar app link gets the same chip", () => {
    publishAppSnapshot([tally, { ...tally, slug: "groceries", title: "Groceries", owner: null }]);
    const { container } = renderMessage(`[list](${ORIGIN}/apps/6/groceries/pane/)`);
    expect(container.querySelector("[data-app-chip]")?.textContent).toContain("Groceries");
  });

  it("a look-alike link on another origin stays a plain link", () => {
    const { container } = renderMessage(`[x](https://attacker.tld/apps/6/tally/pane/)`);
    expect(container.querySelector("[data-app-chip]")).toBeNull();
    expect(screen.getByRole("link", { name: "x" }).getAttribute("target")).toBe("_blank");
  });
});
