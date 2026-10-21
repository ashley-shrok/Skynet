import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const getWhatsNew = vi.fn();
const markWhatsNewSeen = vi.fn();
vi.mock("./whats-new-api", () => ({
  getWhatsNew: (...a: unknown[]) => getWhatsNew(...a),
  markWhatsNewSeen: (...a: unknown[]) => markWhatsNewSeen(...a),
}));

import { WhatsNewModal } from "./WhatsNewModal";

beforeEach(() => {
  getWhatsNew.mockReset();
  markWhatsNewSeen.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

const notes = [
  { id: "c", text: "Newest change." },
  { id: "b", text: "Older change." },
];

describe("WhatsNewModal", () => {
  it("pops up with unseen notes in the order given (newest first)", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal />);
    await screen.findByTestId("whats-new-modal");
    expect(screen.getByText("What's new")).toBeTruthy();
    expect(screen.getAllByTestId("whats-new-note").map((li) => li.textContent)).toEqual([
      "Newest change.",
      "Older change.",
    ]);
  });

  it("'Got it' closes and marks every listed note seen, once", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal />);
    fireEvent.click(await screen.findByTestId("whats-new-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("whats-new-modal")).toBeNull());
    expect(markWhatsNewSeen).toHaveBeenCalledTimes(1);
    expect(markWhatsNewSeen).toHaveBeenCalledWith(["c", "b"]);
  });

  it("Escape also counts as closing", async () => {
    getWhatsNew.mockResolvedValue(notes);
    render(<WhatsNewModal />);
    const modal = await screen.findByTestId("whats-new-modal");
    fireEvent.keyDown(modal, { key: "Escape" });
    await waitFor(() => expect(markWhatsNewSeen).toHaveBeenCalledWith(["c", "b"]));
  });

  it("shows nothing when there is nothing new", async () => {
    getWhatsNew.mockResolvedValue([]);
    render(<WhatsNewModal />);
    await act(async () => {});
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
    expect(markWhatsNewSeen).not.toHaveBeenCalled();
  });

  it("shows nothing when the fetch fails", async () => {
    getWhatsNew.mockRejectedValue(new Error("409"));
    render(<WhatsNewModal />);
    await act(async () => {});
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });
});
