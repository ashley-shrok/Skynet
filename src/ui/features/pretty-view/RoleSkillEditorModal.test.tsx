// RoleSkillEditorModal — rename (folder ↔ name) coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/api/role-skills-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    enumerateRoleSkillFiles: vi.fn().mockResolvedValue([{ path: "notes.md" }, { path: "SKILL.md" }]),
    readRoleSkillFile: vi.fn().mockResolvedValue({
      content: "---\nname: ship\n---\n# Ship\n",
      mtime: 1_700_000_042,
      size: 24,
      isText: true,
    }),
    writeRoleSkillFile: vi.fn().mockResolvedValue({ mtime: 1_700_000_099 }),
    renameRoleSkill: vi.fn().mockResolvedValue({ name: "deploy" }),
  };
});

// A plain textarea stands in for the file tab's editor.
vi.mock("./SkillFileTab", () => ({
  default: (props: {
    state: { status: string; data?: { content: string } };
    onDraftContentChange?: (v: string) => void;
    onDraftChange?: (dirty: boolean) => void;
  }) =>
    props.state.status === "ready" ? (
      <textarea
        data-testid="file-editor"
        defaultValue={props.state.data!.content}
        onChange={(e) => {
          props.onDraftContentChange?.(e.target.value);
          props.onDraftChange?.(e.target.value !== props.state.data!.content);
        }}
      />
    ) : null,
}));

import RoleSkillEditorModal from "./RoleSkillEditorModal";
import * as roleSkillsApi from "@/api/role-skills-api";

function renderModal(onRenamed = vi.fn()) {
  render(
    <RoleSkillEditorModal
      open={true}
      onOpenChange={vi.fn()}
      hostId={1}
      roleName="box-maintainer"
      roleSkillName="ship"
      onRenamed={onRenamed}
      container={document.body}
    />,
  );
  return onRenamed;
}

describe("RoleSkillEditorModal rename", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("the pencil renames the role skill and hands the new slug to the parent", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Deploy");
    const onRenamed = renderModal();
    await screen.findByTestId("file-editor");
    fireEvent.click(screen.getByTestId("role-skill-editor-modal-rename"));
    await waitFor(() => {
      expect(roleSkillsApi.renameRoleSkill).toHaveBeenCalledWith(1, "box-maintainer", "ship", "deploy", undefined);
    });
    expect(onRenamed).toHaveBeenCalledWith("deploy");
  });

  it("opens on SKILL.md even when another file sorts first", async () => {
    renderModal();
    await screen.findByTestId("file-editor");
    expect(roleSkillsApi.readRoleSkillFile).toHaveBeenCalledWith(1, "box-maintainer", "ship", "SKILL.md");
  });

  it("saving SKILL.md with a changed name: renames with the draft riding along", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRenamed = renderModal();
    const editor = (await screen.findByTestId("file-editor")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "---\nname: deploy\n---\n# Ship\n" } });
    await waitFor(() => expect(screen.getByTestId("role-skill-editor-modal-save")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("role-skill-editor-modal-save"));
    await waitFor(() => {
      expect(roleSkillsApi.renameRoleSkill).toHaveBeenCalledWith(1, "box-maintainer", "ship", "deploy", {
        path: "SKILL.md",
        content: "---\nname: deploy\n---\n# Ship\n",
        expectedMtime: 1_700_000_042,
      });
    });
    expect(roleSkillsApi.writeRoleSkillFile).not.toHaveBeenCalled();
    expect(onRenamed).toHaveBeenCalledWith("deploy");
  });
});
