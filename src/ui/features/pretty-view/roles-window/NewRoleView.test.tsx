// The roles window's new-role view: picture first (generate three or
// upload), name, description, colour, host. Create needs name, description
// and a picture. From the library it lands on the new role; from the
// new-conversation dialog's "New role…" it hands back to that dialog.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/identities-api", async (o) => (await import("./roles-window.test-mocks")).identitiesApi(o));
vi.mock("@/api/instance-wide-api", async (o) => (await import("./roles-window.test-mocks")).instanceWideApi(o));
vi.mock("@/api/roles-archive-list-api", async () => (await import("./roles-window.test-mocks")).rolesArchiveListApi());
vi.mock("@/api/role-unarchive-api", async (o) => (await import("./roles-window.test-mocks")).roleUnarchiveApi(o));
vi.mock("@/api/role-archive-api", async () => (await import("./roles-window.test-mocks")).roleArchiveApi());
vi.mock("@/api/claude-session-api", async (o) => (await import("./roles-window.test-mocks")).claudeSessionApi(o));
vi.mock("@/api/role-skills-api", async (o) => (await import("./roles-window.test-mocks")).roleSkillsApi(o));
vi.mock("@/api/scheduled-agents-api", async (o) => (await import("./roles-window.test-mocks")).scheduledAgentsApi(o));
vi.mock("@/api/workspace-api", async (o) => (await import("./roles-window.test-mocks")).workspaceApi(o));
vi.mock("@/api/workspace-git-api", async (o) => (await import("./roles-window.test-mocks")).workspaceGitApi(o));
vi.mock("@/api/voice-api", async (o) => (await import("./roles-window.test-mocks")).voiceApi(o));
vi.mock("@/state/identities-store", async (o) => (await import("./roles-window.test-mocks")).identitiesStore(o));
vi.mock("@mdxeditor/editor", async () => (await import("./roles-window.test-mocks")).mdxEditor());

import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import { RoleAlreadyExistsError } from "@/api/identities-api";
import { m, resetRolesWindowMocks } from "./roles-window.test-mocks";
import {
  BOX,
  HOST_ID,
  MULTI_HOST_TREE,
  SINGLE_HOST_TREE,
  backButton,
  expectLibrary,
  renderWindow,
} from "./roles-window.test-fixtures";

const NEW_ROLE = { name: "meal-planner", description: "Plans the week's meals", displayName: "Meal Planner", colorHue: 10 };

beforeEach(() => {
  resetRolesWindowMocks();
  m.listRolesForHost.mockResolvedValue([BOX]);
  URL.createObjectURL = vi.fn(() => "blob:manual-preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  __resetKitDialogsForTests();
});

async function openNewRole(opts: Parameters<typeof renderWindow>[0] = {}): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const r = renderWindow(opts);
  fireEvent.click((await screen.findAllByTestId("roles-window-new-role"))[0]);
  await screen.findByTestId("new-role-name");
  return r;
}

const createBtn = (): HTMLButtonElement => screen.getByTestId("new-role-create") as HTMLButtonElement;
const generateBtn = (): HTMLButtonElement =>
  screen.getByRole("button", { name: /Generate picture|Regenerate/ }) as HTMLButtonElement;

function fill(name: string, description: string): void {
  fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: name } });
  fireEvent.change(screen.getByTestId("new-role-description"), { target: { value: description } });
}

async function generateAndPick(index = 0): Promise<void> {
  fireEvent.click(generateBtn());
  await waitFor(() => expect(document.querySelectorAll("[data-candidate-id]")).toHaveLength(3));
  fireEvent.click(document.querySelectorAll("[data-candidate-id]")[index]);
}

function stubCandidateFetch(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Blob([new Uint8Array(4)]), { status: 200, headers: { "Content-Type": "image/webp" } }),
  );
}

describe("new role view", () => {
  it("opens from the library's New role with ‹ Roles, a title and the form", async () => {
    await openNewRole();
    expect(screen.getByText("New role")).toBeTruthy();
    expect(backButton().textContent).toContain("Roles");
    // One host: no Host field.
    expect(screen.queryByText("Host")).toBeNull();
  });

  it("Generate needs name + description; Create needs name + description + a picture", async () => {
    await openNewRole();
    expect(generateBtn().disabled).toBe(true);
    expect(createBtn().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: "Meal Planner" } });
    expect(generateBtn().disabled).toBe(true);
    expect(createBtn().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("new-role-description"), { target: { value: "Plans the week's meals" } });
    expect(generateBtn().disabled).toBe(false);
    expect(createBtn().disabled).toBe(true);

    await generateAndPick(1);
    expect(createBtn().disabled).toBe(false);

    // Clearing the description takes Create (and Generate) away again.
    fireEvent.change(screen.getByTestId("new-role-description"), { target: { value: "  " } });
    expect(createBtn().disabled).toBe(true);
    expect(generateBtn().disabled).toBe(true);
  });

  it("Generate sends name, title, brief and colour; three candidates to pick from; then Regenerate", async () => {
    await openNewRole();
    fill("Meal Planner", "Plans the week's meals");
    fireEvent.click(generateBtn());
    await waitFor(() => expect(m.postGenerateAvatarBatch).toHaveBeenCalledTimes(1));
    const arg = m.postGenerateAvatarBatch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ name: "Meal Planner", title: "Meal Planner", brief: "Plans the week's meals" });
    expect(typeof arg.colorHue).toBe("number");
    expect(arg.colorHue as number).toBeGreaterThanOrEqual(0);
    expect(arg.colorHue as number).toBeLessThan(360);
    await waitFor(() => expect(document.querySelectorAll("[data-candidate-id]")).toHaveLength(3));
    expect(screen.getByText("Pick one.")).toBeTruthy();
    const cands = Array.from(document.querySelectorAll<HTMLElement>("[data-candidate-id]"));
    fireEvent.click(cands[1]);
    expect(cands.map((c) => c.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(generateBtn().textContent).toContain("Regenerate");
  });

  it("a failed generate shows the error", async () => {
    m.postGenerateAvatarBatch.mockRejectedValue(new Error("provider down"));
    await openNewRole();
    fill("Meal Planner", "Plans meals");
    fireEvent.click(generateBtn());
    expect(await screen.findByText("provider down")).toBeTruthy();
    expect(createBtn().disabled).toBe(true);
  });

  it("Upload… uses the picked file as the picture and clears any generated candidates", async () => {
    await openNewRole();
    fill("Meal Planner", "Plans meals");
    await generateAndPick();
    const file = new File([new Uint8Array(4)], "custom.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(m.postManualAvatarCandidate).toHaveBeenCalledWith({ file }));
    await waitFor(() => expect(document.querySelectorAll("[data-candidate-id]")).toHaveLength(0));
    expect(screen.getByTestId("new-role-preview").querySelector("img")?.getAttribute("src")).toBe("blob:manual-preview");
    expect(createBtn().disabled).toBe(false);

    fireEvent.click(createBtn());
    await waitFor(() => expect(m.createRole).toHaveBeenCalledTimes(1));
    expect(m.createRole.mock.calls[0][1]).toBe(file);
  });

  it("a name with nothing sluggable is refused", async () => {
    await openNewRole();
    fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: "!!!" } });
    expect(screen.getByText("Name must contain at least one letter")).toBeTruthy();
    fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: "Meal Planner 2" } });
    expect(screen.queryByText("Name must contain at least one letter")).toBeNull();
  });

  it("Create from the library calls createRole (displayName, description, host, colour + the Danielle voice) and lands on the new role", async () => {
    const fetchSpy = stubCandidateFetch();
    m.createRole.mockResolvedValue({ name: "meal-planner", description: "Plans the week's meals", cosmetics: {} });
    m.listRolesForHost.mockResolvedValueOnce([BOX]).mockResolvedValue([BOX, NEW_ROLE]);
    const { onOpenChange } = await openNewRole();
    fill("  Meal Planner ", "  Plans the week's meals ");
    await generateAndPick();
    fireEvent.click(createBtn());

    await waitFor(() => expect(m.createRole).toHaveBeenCalledTimes(1));
    const [input, avatar] = m.createRole.mock.calls[0] as [Record<string, unknown>, File];
    expect(input).toMatchObject({
      displayName: "Meal Planner",
      description: "Plans the week's meals",
      hostId: HOST_ID,
      cosmetics: { voice: "Danielle" },
    });
    expect(typeof (input.cosmetics as { colorHue: unknown }).colorHue).toBe("number");
    expect(avatar).toBeInstanceOf(File);
    expect(avatar.type).toBe("image/webp");
    expect(fetchSpy).toHaveBeenCalledWith("https://img.example/c1.webp");

    // Lands on the new role's own view, not a new conversation.
    await waitFor(() => expect(m.getRoleFileByName).toHaveBeenCalledWith({ roleName: "meal-planner", hostId: HOST_ID }));
    expect(await screen.findByTestId("role-view-facts")).toBeTruthy();
    expect(screen.getByText("Meal Planner", { selector: "[aria-hidden='true']" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    // ‹ Roles → the library, which lists it.
    fireEvent.click(backButton());
    expect(await screen.findByTestId("roles-window-row-meal-planner")).toBeTruthy();
  });

  it("a role that already exists keeps the form open with an inline error", async () => {
    stubCandidateFetch();
    m.createRole.mockRejectedValue(new RoleAlreadyExistsError("meal-planner"));
    await openNewRole();
    fill("Meal Planner", "Plans meals");
    await generateAndPick();
    fireEvent.click(createBtn());
    expect(await screen.findByText('A role named "Meal Planner" could not be created on boreal.')).toBeTruthy();
    expect(screen.getByTestId("new-role-name")).toBeTruthy();
    expect(createBtn().disabled).toBe(false);
  });

  it("several hosts: a Host field, preset to the library's host", async () => {
    stubCandidateFetch();
    await openNewRole({ tree: MULTI_HOST_TREE, start: { view: "library", hostId: 1 } });
    expect(screen.getByText("Host")).toBeTruthy();
    expect(screen.getByRole("option", { name: /alpha/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: /boreal/ }));
    fill("Meal Planner", "Plans meals");
    await generateAndPick();
    fireEvent.click(createBtn());
    await waitFor(() => expect(m.createRole).toHaveBeenCalledTimes(1));
    expect((m.createRole.mock.calls[0][0] as { hostId: number }).hostId).toBe(2);
  });

  it("the window takes the chosen colour", async () => {
    await openNewRole();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "77" } });
    await waitFor(() => expect(screen.getByTestId("roles-window").style.getPropertyValue("--pv-id-hue")).toBe("77"));
  });

  it("Cancel with nothing typed goes straight back to the library", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openNewRole();
    fireEvent.click(screen.getByTestId("new-role-cancel"));
    await expectLibrary();
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Cancel (or back) with typed input asks to discard; 'no' keeps the form, 'yes' leaves", async () => {
    let answer = false;
    const dialogs = autoAnswerKitDialogs({ confirm: () => answer });
    await openNewRole();
    fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: "Half typed" } });

    fireEvent.click(screen.getByTestId("new-role-cancel"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard this new role?");
    expect((screen.getByTestId("new-role-name") as HTMLInputElement).value).toBe("Half typed");

    fireEvent.click(backButton());
    await waitFor(() => expect(dialogs.calls).toHaveLength(2));
    expect(screen.getByTestId("new-role-name")).toBeTruthy();

    answer = true;
    fireEvent.click(screen.getByTestId("new-role-cancel"));
    await expectLibrary();
  });
});

describe("new role view — the new-conversation dialog's 'New role…' hop", () => {
  it("back says Back and hands back to the dialog", async () => {
    const hop = { onBack: vi.fn(), onCreated: vi.fn() };
    renderWindow({ tree: SINGLE_HOST_TREE, start: { view: "new" }, newRoleHop: hop });
    await screen.findByTestId("new-role-name");
    expect(backButton().textContent).toContain("Back");
    fireEvent.click(screen.getByTestId("new-role-cancel"));
    await waitFor(() => expect(hop.onBack).toHaveBeenCalledTimes(1));
    expect(hop.onCreated).not.toHaveBeenCalled();
  });

  it("Create hands the new role back to the dialog instead of opening it here", async () => {
    stubCandidateFetch();
    const hop = { onBack: vi.fn(), onCreated: vi.fn() };
    renderWindow({ tree: SINGLE_HOST_TREE, start: { view: "new" }, newRoleHop: hop });
    await screen.findByTestId("new-role-name");
    fill("Meal Planner", "Plans meals");
    await generateAndPick();
    fireEvent.click(createBtn());
    await waitFor(() => expect(hop.onCreated).toHaveBeenCalledTimes(1));
    const arg = hop.onCreated.mock.calls[0][0] as { role: string; host: { id: string }; description: string };
    expect(arg.role).toBe("meal-planner");
    expect(arg.host.id).toBe("2");
    expect(arg.description).toBe("Plans meals");
    expect(hop.onBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId("role-view-facts")).toBeNull();
  });
});
