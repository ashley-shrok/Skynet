// RoleSkillsTab — list, open, and "+ New skill" coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/api/role-skills-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listRoleSkills: vi.fn().mockResolvedValue([{ name: "ship" }, { name: "admin" }]),
    createRoleSkill: vi.fn().mockResolvedValue({ slug: "daily-check", mtime: 1 }),
  };
});

import { RoleSkillsTab } from "./RoleSkillsTab";
import * as api from "@/api/role-skills-api";

describe("RoleSkillsTab", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("lists the role's skills alphabetically and opens one on click", async () => {
    const onOpen = vi.fn();
    render(<RoleSkillsTab hostId={1} roleName="keeper" onOpenRoleSkill={onOpen} />);
    const admin = await screen.findByText("Admin");
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows).toEqual(["New skill", "Admin", "Ship"]);
    fireEvent.click(admin);
    expect(onOpen).toHaveBeenCalledWith("admin");
  });

  it("explains role skills and still offers New skill when there are none", async () => {
    vi.mocked(api.listRoleSkills).mockResolvedValueOnce([]);
    render(<RoleSkillsTab hostId={1} roleName="keeper" onOpenRoleSkill={vi.fn()} />);
    expect(await screen.findByText("This role has no skills yet.")).toBeInTheDocument();
    expect(screen.getByTestId("role-skills-tab-new-skill")).toBeInTheDocument();
  });

  it("New skill asks for a name and a required description, creates, then opens it", async () => {
    const onOpen = vi.fn();
    const prompt = vi.spyOn(window, "prompt");
    prompt.mockReturnValueOnce("Daily Check").mockReturnValueOnce("  ").mockReturnValueOnce("Check the box daily.");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<RoleSkillsTab hostId={1} roleName="keeper" onOpenRoleSkill={onOpen} />);
    fireEvent.click(await screen.findByTestId("role-skills-tab-new-skill"));
    await waitFor(() =>
      expect(api.createRoleSkill).toHaveBeenCalledWith(1, "keeper", "daily-check", "Check the box daily."),
    );
    expect(alert).toHaveBeenCalledWith("A description is required.");
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("daily-check"));
  });

  it("a taken name says so and opens nothing", async () => {
    const onOpen = vi.fn();
    vi.mocked(api.createRoleSkill).mockRejectedValueOnce(new api.RoleSkillAlreadyExistsError());
    vi.spyOn(window, "prompt").mockReturnValueOnce("ship").mockReturnValueOnce("d");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<RoleSkillsTab hostId={1} roleName="keeper" onOpenRoleSkill={onOpen} />);
    fireEvent.click(await screen.findByTestId("role-skills-tab-new-skill"));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('This role already has a skill named "ship".'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("cancelling the name prompt does nothing", async () => {
    vi.spyOn(window, "prompt").mockReturnValueOnce(null);
    render(<RoleSkillsTab hostId={1} roleName="keeper" onOpenRoleSkill={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("role-skills-tab-new-skill"));
    expect(api.createRoleSkill).not.toHaveBeenCalled();
  });
});
