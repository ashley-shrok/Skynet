/**
 * ComposeBox — Condense conversation (memory pop-over).
 *
 * The button asks first (kitConfirm), then posts the condense request with
 * whatever is typed as guidance. Success clears the box and tells the parent;
 * failure keeps the text and says so. While condensing, the pie says so and
 * nothing in the composer is disabled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import {
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
  type KitConfirmOptions,
} from "@/components/kit";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/api/identity-send-log-api", () => ({
  stampIdentitySendLog: vi.fn(),
}));

vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: { skills: [] } }) },
  };
});

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { authApi } from "@/main-axios";

const postMock = authApi.post as unknown as ReturnType<typeof vi.fn>;

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 42,
    tmuxSession: "ivy",
    identityKey: "ivy",
    identityName: "Ivy",
    canSend: true,
    ...overrides,
  };
}

async function pressCondense() {
  fireEvent.click(screen.getByTestId("memory-gauge"));
  const btn = await screen.findByRole("button", { name: "Condense conversation" });
  act(() => {
    fireEvent.click(btn);
  });
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("ComposeBox — Condense conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    postMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    __resetKitDialogsForTests();
  });

  it("asks first; a dismissed confirm requests nothing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<ComposeBox {...baseProps()} />);
    await pressCondense();
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    const opts = dialogs.calls[0].opts as KitConfirmOptions;
    expect(String(opts.title)).toBe("Condense this conversation?");
    expect(String(opts.body)).toContain("Anything you've typed guides what the summary keeps.");
    await new Promise((r) => setTimeout(r, 0));
    expect(postMock).not.toHaveBeenCalled();
  });

  it("accepted: posts the request with the typed text as guidance, then clears the box", async () => {
    autoAnswerKitDialogs({ confirm: true });
    const onCondenseRequested = vi.fn();
    render(<ComposeBox {...baseProps({ onCondenseRequested })} />);
    fireEvent.change(textarea(), { target: { value: "  keep the failing test details " } });
    await pressCondense();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith("/identities/ivy/condense", {
      hostId: 42,
      guidance: "keep the failing test details",
    });
    await waitFor(() => expect(onCondenseRequested).toHaveBeenCalledTimes(1));
    expect(textarea().value).toBe("");
  });

  it("text typed while the request is in flight is kept", async () => {
    autoAnswerKitDialogs({ confirm: true });
    let resolvePost: (v: unknown) => void = () => {};
    postMock.mockReturnValue(new Promise((r) => (resolvePost = r)));
    const onCondenseRequested = vi.fn();
    render(<ComposeBox {...baseProps({ onCondenseRequested })} />);
    fireEvent.change(textarea(), { target: { value: "keep this" } });
    await pressCondense();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    fireEvent.change(textarea(), { target: { value: "keep this — and a new thought" } });
    await act(async () => {
      resolvePost({ data: { ok: true } });
    });
    await waitFor(() => expect(onCondenseRequested).toHaveBeenCalledTimes(1));
    expect(textarea().value).toBe("keep this — and a new thought");
  });

  it("falls back to the tmux session when no identity key is given", async () => {
    autoAnswerKitDialogs({ confirm: true });
    render(<ComposeBox {...baseProps({ identityKey: undefined })} />);
    await pressCondense();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0][0]).toBe("/identities/ivy/condense");
  });

  it("a failed request keeps the text, says so, and doesn't tell the parent", async () => {
    autoAnswerKitDialogs({ confirm: true });
    postMock.mockRejectedValue(new Error("network"));
    const onCondenseRequested = vi.fn();
    render(<ComposeBox {...baseProps({ onCondenseRequested })} />);
    fireEvent.change(textarea(), { target: { value: "keep this" } });
    await pressCondense();
    await waitFor(() => expect(screen.getByText("Not connected — try again in a moment")).toBeTruthy());
    expect(textarea().value).toBe("keep this");
    expect(onCondenseRequested).not.toHaveBeenCalled();
  });

  it("never sends a chat message or an /id command", async () => {
    autoAnswerKitDialogs({ confirm: true });
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    await pressCondense();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("while condensing: the pie says so and Send still works", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, condensing: true })} />);
    expect(screen.getByTestId("memory-gauge").getAttribute("data-condensing")).toBe("true");
    fireEvent.change(textarea(), { target: { value: "hello" } });
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });
});
