import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import type { ShareState, SharePlanSummary } from "@/api/sharing-api";

const api = vi.hoisted(() => ({
  getSharing: vi.fn(),
  planSharing: vi.fn(),
  applySharing: vi.fn(),
}));
vi.mock("@/api/sharing-api", () => api);

import { SharedWithButton, describeReach, sharedWithLabel } from "./SharedWithButton";

type Loaded = Extract<ShareState, { multiUser: true }>;
const state = (o: Partial<Loaded> = {}): Loaded => {
  const people = o.people ?? ["ana", "bo", "cy"];
  const users = o.users === undefined ? ["ana"] : o.users;
  const ticked = o.ticked ?? users ?? people;
  return {
    multiUser: true,
    you: "ana",
    people,
    users,
    ticked,
    former: ticked.filter((u) => !people.includes(u)),
    hiddenBy: {},
    instanceWide: false,
    ...o,
  };
};
const emptyPlan = (o: Partial<SharePlanSummary> = {}): SharePlanSummary => ({
  added: [],
  removed: [],
  rolesToShare: [],
  alsoShared: { projects: [], agents: [], roles: [], hidden: 0 },
  alsoUnshared: { projects: [], agents: [], hidden: 0 },
  keptShared: [],
  keptHidden: 0,
  disappearing: [],
  disappearingHidden: 0,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  __resetKitDialogsForTests();
});

describe("sharedWithLabel", () => {
  it("names who can see it", () => {
    expect(sharedWithLabel(state({ users: null }))).toBe("Everyone on this machine");
    // A sub-project with no list of its own, under a limited project.
    expect(sharedWithLabel(state({ users: null, ticked: ["ana", "bo"] }))).toBe("You and bo");
    expect(sharedWithLabel(state({ users: ["ana"] }))).toBe("Only you");
    expect(sharedWithLabel(state({ users: ["ana", "bo"] }))).toBe("You and bo");
    expect(sharedWithLabel(state({ users: ["bo", "ana", "cy"] }))).toBe("You, bo and cy");
    expect(
      sharedWithLabel(state({ people: ["ana", "bo", "cy", "di", "ed"], users: ["ana", "bo", "cy", "di", "ed"] })),
    ).toBe("You, bo and 3 others");
  });

  it("leaves out people no longer on the machine", () => {
    expect(sharedWithLabel(state({ users: ["ana", "gone"] }))).toBe("Only you");
  });
});

describe("describeReach", () => {
  it("counts what the person can't see instead of naming it", () => {
    expect(describeReach({ projects: [], agents: ["Scout"], hidden: 2 })).toBe("Scout and 2 more you can't see");
    expect(describeReach({ projects: [], agents: [], hidden: 1 })).toBe("1 thing you can't see");
  });

  it("names sub-projects, agents and roles", () => {
    expect(describeReach({ projects: ["Prints"], agents: ["Scout", "Robin"], roles: ["Painter"] })).toBe(
      "the Prints sub-project, 2 agents (Scout and Robin) and the Painter role",
    );
  });
});

describe("SharedWithButton", () => {
  const props = { hostId: 3, kind: "agent" as const, slug: "scout", itemLabel: "Scout" };

  it("says which project above hides a sub-project from someone ticked", async () => {
    api.getSharing.mockResolvedValue(
      state({ users: ["ana", "bo"], hiddenBy: { bo: [{ kind: "project", name: "top", label: "Top", fixable: false }] } }),
    );
    render(<SharedWithButton hostId={3} kind="project" slug="kid" itemLabel="Kid" />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect(await screen.findByText("Hidden by the Top project")).toBeTruthy();
    expect(screen.queryByTestId("shared-with-share-role-bo")).toBeNull();
  });

  it("reloads the list when a change fails", async () => {
    api.getSharing.mockResolvedValue(state());
    api.planSharing.mockResolvedValue(emptyPlan({ added: ["bo"] }));
    api.applySharing.mockRejectedValue(new Error("boom"));
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    const loadsBefore = api.getSharing.mock.calls.length;
    fireEvent.click(await screen.findByLabelText("bo"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(api.getSharing.mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  it("shows nothing on a machine with one person", async () => {
    api.getSharing.mockResolvedValue({ multiUser: false });
    const { container } = render(<SharedWithButton {...props} />);
    await waitFor(() => expect(api.getSharing).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("offers to share the role too, and shares both on yes", async () => {
    api.getSharing.mockResolvedValue(state());
    api.planSharing.mockResolvedValue(
      emptyPlan({ added: ["bo"], rolesToShare: [{ name: "painter", label: "Painter", people: ["bo"] }] }),
    );
    api.applySharing.mockResolvedValue(state({ users: ["ana", "bo"] }));
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(await screen.findByLabelText("bo"));
    await waitFor(() => expect(api.applySharing).toHaveBeenCalled());
    expect(dialogs.calls[0].opts.title).toBe("Share the Painter role with bo too?");
    expect(api.applySharing).toHaveBeenCalledWith(
      { hostId: 3, kind: "agent", slug: "scout" },
      { add: ["bo"], shareRoles: true },
    );
    expect(await screen.findByText("You and bo")).toBeTruthy();
  });

  it("does nothing when the role offer is turned down", async () => {
    api.getSharing.mockResolvedValue(state());
    api.planSharing.mockResolvedValue(
      emptyPlan({ added: ["bo"], rolesToShare: [{ name: "painter", label: "Painter", people: ["bo"] }] }),
    );
    autoAnswerKitDialogs({ confirm: false });
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(await screen.findByLabelText("bo"));
    await waitFor(() => expect(api.planSharing).toHaveBeenCalled());
    expect(api.applySharing).not.toHaveBeenCalled();
  });

  it("won't let the last person be unticked", async () => {
    api.getSharing.mockResolvedValue(state());
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect((await screen.findByLabelText("ana (you)")).hasAttribute("disabled")).toBe(true);
  });

  it("warns before you take yourself off, then reports the thing gone", async () => {
    api.getSharing.mockResolvedValue(state({ users: ["ana", "bo"] }));
    api.planSharing.mockResolvedValue(emptyPlan({ removed: ["ana"] }));
    api.applySharing.mockResolvedValue({ gone: true });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    const onGone = vi.fn();
    render(<SharedWithButton {...props} onGone={onGone} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(await screen.findByLabelText("ana (you)"));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
    expect(dialogs.calls[0].opts.title).toBe("Take yourself off Scout?");
  });

  it("says when a role hides it from someone ticked, and shares just that role", async () => {
    api.getSharing.mockResolvedValue(
      state({ users: ["ana", "bo"], hiddenBy: { bo: [{ kind: "role", name: "painter", label: "Painter", fixable: true }] } }),
    );
    api.applySharing.mockResolvedValue(state({ users: ["ana", "bo"] }));
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect(await screen.findByText("Hidden by the Painter role")).toBeTruthy();
    fireEvent.click(screen.getByTestId("shared-with-share-role-bo"));
    await waitFor(() =>
      expect(api.applySharing).toHaveBeenCalledWith(
        { hostId: 3, kind: "agent", slug: "scout" },
        { shareRoles: false, shareRolesFor: ["bo"] },
      ),
    );
    expect(api.planSharing).not.toHaveBeenCalled();
  });

  it("shows people who've lost access greyed, and they can be unticked", async () => {
    api.getSharing.mockResolvedValue(state({ users: ["ana", "gone"], former: ["gone"] }));
    api.planSharing.mockResolvedValue(emptyPlan({ removed: ["gone"] }));
    api.applySharing.mockResolvedValue(state({ users: ["ana"] }));
    render(<SharedWithButton {...props} />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect(await screen.findByText("No longer on this machine")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("gone"));
    await waitFor(() =>
      expect(api.applySharing).toHaveBeenCalledWith(expect.anything(), { remove: ["gone"], shareRoles: false }),
    );
  });

  it("confirms a project share naming what else it shares", async () => {
    api.getSharing.mockResolvedValue(state());
    api.planSharing.mockResolvedValue(
      emptyPlan({ added: ["bo"], alsoShared: { projects: ["Prints"], agents: ["Scout"], roles: [], hidden: 0 } }),
    );
    api.applySharing.mockResolvedValue(state({ users: ["ana", "bo"] }));
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<SharedWithButton hostId={3} kind="project" slug="garden" itemLabel="Garden" />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(await screen.findByLabelText("bo"));
    await waitFor(() => expect(api.applySharing).toHaveBeenCalled());
    expect(dialogs.calls[0].opts.title).toBe("Share Garden with bo?");
    expect(dialogs.calls[0].opts.body).toBe("It also shares the Prints sub-project and Scout with bo.");
  });
});

describe("SharedWithButton on a task and inline", () => {
  it("offers a task's role too, in the task's words", async () => {
    api.getSharing.mockResolvedValue(state());
    api.planSharing.mockResolvedValue(
      emptyPlan({ added: ["bo"], rolesToShare: [{ name: "painter", label: "Painter", people: ["bo"] }] }),
    );
    api.applySharing.mockResolvedValue(state({ users: ["ana", "bo"] }));
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<SharedWithButton hostId={3} kind="task" slug="morning" itemLabel="Morning" />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    fireEvent.click(await screen.findByLabelText("bo"));
    await waitFor(() => expect(api.applySharing).toHaveBeenCalled());
    expect(dialogs.calls[0].opts.title).toBe("Share the Painter role with bo too?");
    expect(String(dialogs.calls[0].opts.body)).toContain("The conversations Morning starts");
  });

  it("says a role hides a task's conversations", async () => {
    api.getSharing.mockResolvedValue(
      state({ users: ["ana", "bo"], hiddenBy: { bo: [{ kind: "role", name: "painter", label: "Painter", fixable: true }] } }),
    );
    render(<SharedWithButton hostId={3} kind="task" slug="morning" itemLabel="Morning" />);
    fireEvent.click(await screen.findByTestId("shared-with-button"));
    expect(await screen.findByText("Its conversations are hidden by the Painter role")).toBeTruthy();
  });

  it("inline shows the list in place, with no button", async () => {
    api.getSharing.mockResolvedValue(state());
    render(<SharedWithButton inline hostId={3} kind="app" slug="tracker" itemLabel="Tracker" />);
    expect(await screen.findByLabelText("bo")).toBeTruthy();
    expect(screen.queryByTestId("shared-with-button")).toBeNull();
  });

  it("as a field, shows its label only on a machine with several people", async () => {
    api.getSharing.mockResolvedValue({ multiUser: false });
    const { container } = render(<SharedWithButton field hostId={3} kind="task" slug="morning" itemLabel="Morning" />);
    await waitFor(() => expect(api.getSharing).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
