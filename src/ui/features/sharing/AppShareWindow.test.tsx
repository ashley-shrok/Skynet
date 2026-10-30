import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getSharing: vi.fn(),
  planSharing: vi.fn(),
  applySharing: vi.fn(),
  isMultiUserMachine: vi.fn(),
}));
vi.mock("@/api/sharing-api", () => api);

import { __resetAppShareWindowForTests, openAppShareWindow, useMultiUserMachine } from "./AppShareWindow";

beforeEach(() => vi.clearAllMocks());
afterEach(() => __resetAppShareWindowForTests());

describe("AppShareWindow", () => {
  it("opens the app's list in a window; Done closes it", async () => {
    api.getSharing.mockResolvedValue({
      multiUser: true,
      you: "ana",
      people: ["ana", "bo"],
      users: null,
      ticked: ["ana", "bo"],
      former: [],
      hiddenBy: {},
      instanceWide: false,
    });
    act(() => openAppShareWindow({ hostId: 3, slug: "tracker", title: "Tracker" }));
    expect(await screen.findByText("Share Tracker")).toBeTruthy();
    expect(await screen.findByLabelText("bo")).toBeTruthy();
    expect(api.getSharing).toHaveBeenCalledWith({ hostId: 3, kind: "app", slug: "tracker" });
    fireEvent.click(screen.getByTestId("app-share-done"));
    await waitFor(() => expect(screen.queryByText("Share Tracker")).toBeNull());
  });
});

describe("useMultiUserMachine", () => {
  function Probe({ hostId }: { hostId: number }) {
    return <span>{useMultiUserMachine(hostId) ? "several" : "one"}</span>;
  }

  it("is true only once the machine is known to have several people", async () => {
    api.isMultiUserMachine.mockResolvedValue(true);
    render(<Probe hostId={3} />);
    expect(screen.getByText("one")).toBeTruthy();
    expect(await screen.findByText("several")).toBeTruthy();
  });
});
