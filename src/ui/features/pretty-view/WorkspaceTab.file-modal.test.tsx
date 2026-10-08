/**
 * WorkspaceTab — opening a file stacks the full-size file modal over the
 * list instead of swapping the list out. Closing it lands back on the list.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/api/workspace-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/workspace-api")>();
  return {
    ...actual,
    listWorkspace: vi.fn(async () => ({
      path: "",
      entries: [
        { name: "photo.png", type: "file", size: 1234, mtimeMs: 0, path: "photo.png" },
      ],
    })),
    readWorkspaceFile: vi.fn(),
  };
});

import WorkspaceTab from "./WorkspaceTab";
import { listWorkspace } from "@/api/workspace-api";

describe("WorkspaceTab file modal", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("opens the file in a stacked modal and returns to the list on close", async () => {
    render(
      <WorkspaceTab target={{ kind: "identity", identityKey: "ada" }} hostId={1} hue={190} />,
    );

    fireEvent.click(await screen.findByText("photo.png"));

    const modal = await screen.findByTestId("workspace-file-modal");
    expect(modal.textContent).toContain("photo.png");
    expect(modal.textContent).toContain("Download");
    // The list stays mounted underneath.
    expect(listWorkspace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByTestId("workspace-file-modal")).toBeNull(),
    );
    expect(screen.getByText("photo.png")).toBeTruthy();
    // Closing refreshes the listing so saves show up in size / modified.
    await waitFor(() => expect(listWorkspace).toHaveBeenCalledTimes(2));
  });
});
