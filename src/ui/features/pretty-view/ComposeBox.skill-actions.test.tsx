import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// In-process coverage for the skill-actions menu (shape skill-action-menu):
// the lightning-bolt button in ComposeBox's aux row, driven the way a user
// does — open the menu with the pointer, tap a skill, see it sent.

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const listSkillsMock = vi.fn();
vi.mock("@/api/skills-api", () => ({
  listSkills: (hostId: number) => listSkillsMock(hostId),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { __resetSkillActionsStoreForTests } from "./skill-actions-store";

const SKILLS = [
  { name: "recap", description: "Gives a concise recap of the session." },
  { name: "light-review", description: "Unbiased sub-agent code review" },
  { name: "explain" },
];

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    identityName: "garnet",
    canSend: true,
    ...overrides,
  };
}

/** Radix DropdownMenu opens on a primary-button pointerdown. */
function openMenu(button: HTMLElement): void {
  act(() => {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
}

async function findButton(): Promise<HTMLButtonElement> {
  return (await screen.findByTestId("skill-actions-button")) as HTMLButtonElement;
}

describe("ComposeBox — skill-actions menu", () => {
  beforeEach(() => {
    __resetSkillActionsStoreForTests();
    localStorage.clear();
    listSkillsMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
  });

  it("button appears left of thumbs-up once the host's skills are known", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    expect(btn.getAttribute("aria-label")).toBe("Skills");
    const thumbs = screen.getByLabelText("Send 'thumbs up'");
    expect(btn.nextElementSibling).toBe(thumbs);
    expect(listSkillsMock).toHaveBeenCalledWith(1);
  });

  it("menu lists every skill alphabetically with descriptions", async () => {
    render(<ComposeBox {...baseProps()} />);
    openMenu(await findButton());
    const menu = await screen.findByTestId("skill-actions-menu");
    const names = Array.from(menu.querySelectorAll("[data-testid^='skill-actions-item-']")).map(
      (el) => el.getAttribute("data-testid")!.replace("skill-actions-item-", ""),
    );
    expect(names).toEqual(["explain", "light-review", "recap"]);
    const lr = screen.getByTestId("skill-actions-item-light-review");
    expect(lr.textContent).toContain("/light-review");
    expect(lr.textContent).toContain("Unbiased sub-agent code review");
  });

  it("tapping a skill sends /<name> at once, jumps to bottom, and leaves the typed draft alone", async () => {
    const onSend = vi.fn(() => true);
    const onGoodToGo = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onGoodToGo })} />);
    const textarea = screen.getByPlaceholderText("Write a message…") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "half-written thought" } });

    openMenu(await findButton());
    fireEvent.click(await screen.findByTestId("skill-actions-item-light-review"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/light-review");
    expect(onGoodToGo).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("half-written thought");
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
  });

  it("opening the menu refreshes the list in the background", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(1));
    openMenu(btn);
    await screen.findByTestId("skill-actions-menu");
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
  });

  it("renders instantly from the remembered list (no fetch needed first)", async () => {
    listSkillsMock.mockReturnValue(new Promise(() => {})); // fetch never lands
    localStorage.setItem("skynet:skill-actions:v1:__anon:1", JSON.stringify(SKILLS));
    render(<ComposeBox {...baseProps()} />);
    expect(screen.getByTestId("skill-actions-button")).toBeTruthy();
  });

  it("hidden when the host has no skills", async () => {
    listSkillsMock.mockResolvedValue([]);
    render(<ComposeBox {...baseProps()} />);
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("skill-actions-button")).toBeNull();
  });

  it("hidden (and no fetch) in relay panes", async () => {
    render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    await act(async () => {});
    expect(screen.queryByTestId("skill-actions-button")).toBeNull();
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("the open menu keeps its rows still while a background refresh lands", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(1));
    listSkillsMock.mockResolvedValueOnce([{ name: "aaa-new" }, ...SKILLS]);
    openMenu(btn);
    await screen.findByTestId("skill-actions-menu");
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    // Refresh landed, but the open menu still shows the open-time list.
    expect(screen.queryByTestId("skill-actions-item-aaa-new")).toBeNull();
    // Close + reopen: the new skill appears.
    act(() => {
      fireEvent.keyDown(screen.getByTestId("skill-actions-menu"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
    openMenu(btn);
    expect(await screen.findByTestId("skill-actions-item-aaa-new")).toBeTruthy();
  });

  it("an open menu closes when the button becomes disabled", async () => {
    const { rerender } = render(<ComposeBox {...baseProps()} />);
    openMenu(await findButton());
    await screen.findByTestId("skill-actions-menu");
    rerender(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
  });

  it("a failed dispatch shows the same not-connected message as thumbs-up", async () => {
    render(<ComposeBox {...baseProps({ onSend: vi.fn(() => false) })} />);
    openMenu(await findButton());
    fireEvent.click(await screen.findByTestId("skill-actions-item-recap"));
    expect(await screen.findByText(/not connected/i)).toBeTruthy();
  });

  it("a failed first fetch with nothing remembered is retried, then the button appears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listSkillsMock.mockReset();
      listSkillsMock.mockRejectedValueOnce(new Error("SSH connect failed"));
      listSkillsMock.mockResolvedValue(SKILLS);
      render(<ComposeBox {...baseProps()} />);
      await act(async () => {});
      expect(screen.queryByTestId("skill-actions-button")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByTestId("skill-actions-button")).toBeTruthy();
      expect(listSkillsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["recycleActive", { recycleActive: true }],
    ["reconnectingActive", { reconnectingActive: true }],
    ["asideActive", { asideActive: true }],
  ])("disabled exactly like thumbs-up while %s", async (_label, extra) => {
    render(<ComposeBox {...baseProps(extra)} />);
    const btn = await findButton();
    expect(btn.disabled).toBe(true);
    expect((screen.getByLabelText("Send 'thumbs up'") as HTMLButtonElement).disabled).toBe(true);
  });
});
