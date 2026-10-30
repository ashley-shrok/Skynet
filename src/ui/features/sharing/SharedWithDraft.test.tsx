import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMachinePeople: vi.fn() }));
vi.mock("@/api/sharing-api", () => api);

import { SharedWithDraft } from "./SharedWithDraft";

beforeEach(() => vi.clearAllMocks());
afterEach(() => __resetKitDialogsForTests());

describe("SharedWithDraft", () => {
  it("starts at everyone and hands back a list once someone is unticked", async () => {
    api.getMachinePeople.mockResolvedValue({ multiUser: true, you: "ana", people: ["ana", "bo", "cy"] });
    const onChange = vi.fn();
    render(<SharedWithDraft field hostId={3} value={null} onChange={onChange} />);
    expect(await screen.findByText("Everyone on this machine")).toBeTruthy();
    expect(screen.getByText("Shared with")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shared-with-button"));
    fireEvent.click(screen.getByLabelText("cy"));
    expect(onChange).toHaveBeenCalledWith(["ana", "bo"]);
  });

  it("won't let the last person be unticked", async () => {
    api.getMachinePeople.mockResolvedValue({ multiUser: true, you: "ana", people: ["ana", "bo"] });
    render(<SharedWithDraft hostId={3} value={["ana"]} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect(screen.getByLabelText("ana (you)").hasAttribute("disabled")).toBe(true);
  });

  it("shows nothing on a machine with one person", async () => {
    api.getMachinePeople.mockResolvedValue({ multiUser: false });
    const { container } = render(<SharedWithDraft field hostId={3} value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(api.getMachinePeople).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});

describe("SharedWithDraft: leaving yourself off", () => {
  it("asks first, and keeps you on when the answer is no", async () => {
    api.getMachinePeople.mockResolvedValue({ multiUser: true, you: "ana", people: ["ana", "bo"] });
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const onChange = vi.fn();
    render(<SharedWithDraft hostId={3} value={null} onChange={onChange} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(screen.getByLabelText("ana (you)"));
    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(dialogs.calls[0].opts.title).toBe("Leave yourself off?");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves you off on yes", async () => {
    api.getMachinePeople.mockResolvedValue({ multiUser: true, you: "ana", people: ["ana", "bo"] });
    autoAnswerKitDialogs({ confirm: true });
    const onChange = vi.fn();
    render(<SharedWithDraft hostId={3} value={null} onChange={onChange} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(screen.getByLabelText("ana (you)"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["bo"]));
  });
});
