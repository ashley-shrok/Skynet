import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const getWhatsNew = vi.fn();
const markWhatsNewSeen = vi.fn();
vi.mock("./whats-new-api", () => ({
  getWhatsNew: (...a: unknown[]) => getWhatsNew(...a),
  markWhatsNewSeen: (...a: unknown[]) => markWhatsNewSeen(...a),
}));

import { WhatsNewModal } from "./WhatsNewModal";
import { publishBrandingConfig, __resetForTest as resetBranding } from "@/branding/branding-store";

beforeEach(() => {
  localStorage.clear();
  getWhatsNew.mockReset();
  markWhatsNewSeen.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  resetBranding();
});

const notes = [
  { id: "c", text: "Newest change." },
  { id: "b", text: "Older change." },
];

describe("WhatsNewModal", () => {
  it("pops up with unseen notes in the order given (newest first)", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    await screen.findByTestId("whats-new-modal");
    expect(screen.getByRole("dialog", { name: "What's new" })).toBeTruthy();
    expect(screen.getAllByTestId("whats-new-note").map((li) => li.textContent)).toEqual([
      "Newest change.",
      "Older change.",
    ]);
    // The notes are one grouped list.
    const list = screen.getByTestId("whats-new-notes");
    expect(list.tagName).toBe("UL");
    expect(list.classList.contains("k-group")).toBe(true);
    expect(screen.getAllByTestId("whats-new-note").every((li) => list.contains(li))).toBe(true);
  });

  it("the title names the instance from its branding, not a hard-coded \"Skynet\"", async () => {
    publishBrandingConfig({
      appName: "Acme Hub",
      shortName: "Acme",
      iconPath: "/branding/icon.png",
      wordmarkPath: "/branding/wordmark.png",
      faviconPath: "/branding/favicon.svg",
      wipIndicatorPath: "/branding/wip-cube.webp",
      pwaIcons: [],
      avatarDirectorSpec: "",
      avatarGammaDefault: 0.7,
    });
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    const modal = await screen.findByTestId("whats-new-modal");
    expect(screen.getByTestId("whats-new-title").textContent).toBe("What's new in Acme Hub");
    expect(modal.textContent).not.toMatch(/skynet/i);
  });

  it("the title follows the default branding when nothing is published", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    await screen.findByTestId("whats-new-modal");
    expect(screen.getByTestId("whats-new-title").textContent).toBe("What's new in SKYNET");
  });

  it("one full-width Continue at the foot — no \"Got it\"", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    const btn = await screen.findByTestId("whats-new-dismiss");
    expect(btn.textContent).toBe("Continue");
    expect(btn.getAttribute("data-full")).toBe("true");
    expect(screen.queryByText(/got it/i)).toBeNull();
    expect(screen.getAllByRole("button", { name: /continue/i })).toHaveLength(1);
  });

  it("Continue closes and marks every listed note seen, once", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    fireEvent.click(await screen.findByTestId("whats-new-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("whats-new-modal")).toBeNull());
    expect(markWhatsNewSeen).toHaveBeenCalledTimes(1);
    expect(markWhatsNewSeen).toHaveBeenCalledWith(["c", "b"]);
  });

  it("the X also counts as closing", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    await screen.findByTestId("whats-new-modal");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByTestId("whats-new-modal")).toBeNull());
    expect(markWhatsNewSeen).toHaveBeenCalledTimes(1);
    expect(markWhatsNewSeen).toHaveBeenCalledWith(["c", "b"]);
  });

  it("Escape also counts as closing", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal username="ash" />);
    const modal = await screen.findByTestId("whats-new-modal");
    fireEvent.keyDown(modal, { key: "Escape" });
    await waitFor(() => expect(markWhatsNewSeen).toHaveBeenCalledWith(["c", "b"]));
  });

  it("shows nothing when there is nothing new", async () => {
    getWhatsNew.mockResolvedValue([]);
    render(<WhatsNewModal username="ash" />);
    await act(async () => {});
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
    expect(markWhatsNewSeen).not.toHaveBeenCalled();
  });

  it("shows nothing when the fetch fails", async () => {
    getWhatsNew.mockRejectedValue(new Error("409"));
    render(<WhatsNewModal username="ash" />);
    await act(async () => {});
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });

  it("a failed mark-seen is retried on the next load and the notes don't re-show", async () => {
    getWhatsNew.mockResolvedValue(notes);
    markWhatsNewSeen.mockRejectedValueOnce(new Error("409 stale_client"));
    const first = render(<WhatsNewModal username="ash" />);
    fireEvent.click(await screen.findByTestId("whats-new-dismiss"));
    await waitFor(() => expect(markWhatsNewSeen).toHaveBeenCalledTimes(1));
    first.unmount();

    // Reload: server still says unseen (save never landed).
    render(<WhatsNewModal username="ash" />);
    await waitFor(() => expect(markWhatsNewSeen).toHaveBeenCalledTimes(2));
    expect(markWhatsNewSeen).toHaveBeenLastCalledWith(["c", "b"]);
    await act(async () => {});
    expect(localStorage.getItem("skynet-whats-new-pending-seen:ash")).toBeNull();
  });

  it("if the retry also fails, already-read notes are still not re-shown", async () => {
    localStorage.setItem("skynet-whats-new-pending-seen:ash", JSON.stringify(["c", "b"]));
    markWhatsNewSeen.mockRejectedValue(new Error("offline"));
    getWhatsNew.mockResolvedValue([{ id: "d", text: "Brand new." }, ...notes]);
    render(<WhatsNewModal username="ash" />);
    await screen.findByTestId("whats-new-modal");
    expect(screen.getAllByTestId("whats-new-note").map((li) => li.textContent)).toEqual(["Brand new."]);
  });

  it("pending ids are per username", async () => {
    localStorage.setItem("skynet-whats-new-pending-seen:someone-else", JSON.stringify(["c"]));
    getWhatsNew.mockResolvedValue([]);
    render(<WhatsNewModal username="ash" />);
    await act(async () => {});
    expect(markWhatsNewSeen).not.toHaveBeenCalled();
  });
});
