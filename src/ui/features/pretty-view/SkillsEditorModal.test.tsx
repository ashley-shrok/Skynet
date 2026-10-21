/**
 * SkillsEditorModal tests — library view (switches, sections, filter) and
 * skill view (opens on SKILL.md, collapsed files, unsaved-edit guards), plus
 * the Phase 44 file/skill CRUD seams.
 *
 * Byte-shape mirror of GlobalFilesModal.test.tsx (quick 260805-7rq) with the
 * skill dimension threaded into every fixture. The primary test (#1) is the
 * lazy-load race regression: the ~700ms SSH read must resolve into a rendered
 * textarea without being cancelled by a spurious tabData-in-deps effect re-run.
 *
 * Additional tests cover the Phase 44 seams:
 *   - host pick triggers listSkills
 *   - skill pick triggers enumerateSkillFiles
 *   - non-text file → shared can't-preview notice + no textbox
 *   - + Add file prompt round-trip (create + refetch)
 *   - delete-file confirm dialog fires deleteSkillFile
 *   - delete-skill confirm dialog fires deleteSkill
 *   - RDP-only hosts are filtered from the host <select>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HostFolder } from "@/types/ui-types";

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

// Instance-wide list: none (keeps these tests off the network).
vi.mock("@/api/instance-wide-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, listInstanceWide: vi.fn().mockResolvedValue({ isAdmin: false, items: [] }) };
});

vi.mock("@/api/skills-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listSkills: vi.fn().mockResolvedValue([
      { name: "build" },
      { name: "explain" },
    ]),
    enumerateSkillFiles: vi.fn().mockResolvedValue([
      { path: "SKILL.md" },
      { path: "tests/basic.py" },
    ]),
    readSkillFile: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        content: "MOCKED SKILL FILE CONTENT",
        mtime: 1_700_000_042,
        size: 26,
        isText: true,
      };
    }),
    writeSkillFile: vi.fn().mockResolvedValue({ mtime: 1_700_000_099 }),
    createSkillFile: vi.fn().mockResolvedValue({ path: "new.md", mtime: 1_700_000_101 }),
    createSkill: vi.fn().mockResolvedValue({ slug: "new-skill", mtime: 1_700_000_200 }),
    deleteSkillFile: vi.fn().mockResolvedValue(undefined),
    deleteSkill: vi.fn().mockResolvedValue(undefined),
    renameSkill: vi.fn().mockResolvedValue({ name: "ship", mtime: 1_700_000_300 }),
  };
});

// Stub MDXEditor with a controlled textarea so getByRole("textbox") keeps
// working after the .md filetype gate routes through the WYSIWYG branch (Phase
// 112). Mirrors the mock in EditableFileModal.test.tsx.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: {
    markdown: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      value={props.markdown}
      onChange={(e) => props.onChange?.(e.target.value)}
      disabled={props.readOnly}
      data-testid="mdxeditor"
    />
  ),
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  tablePlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
  frontmatterPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  InsertTable: () => null,
  ListsToggle: () => null,
  InsertFrontmatter: () => null,
}));

// ── Late imports (after mocks are registered) ────────────────────────────────
import SkillsEditorModal from "./SkillsEditorModal";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import * as skillsApi from "@/api/skills-api";

// ── Shared fixture ────────────────────────────────────────────────────────────

// Minimal HostFolder tree — only fields consumed by collectAllHosts + the <select>.
// Host id must be a string (per ui-types.ts Host.id: string); defaultHostId is number.
// enableRdp must NOT be true so the host passes the filter.
const HOST_TREE: HostFolder = {
  name: "root",
  children: [
    {
      id: "1",
      name: "thenasty",
      enableRdp: false,
      enableSsh: true,
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "ubuntu",
      ip: "10.0.0.1",
      port: 22,
      folder: "",
      online: true,
      cpu: null,
      ram: null,
      lastAccess: "",
      authType: "key",
      serverTunnels: [],
      quickActions: [],
      sshPort: 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
    },
  ],
};

// Fixture including an RDP-only host that MUST be filtered out. Phase 113
// D-17: the modal hides the host <select> entirely when flatHosts.length === 1,
// so this fixture carries a SECOND SSH host so the picker still renders after
// the RDP filter, letting the RDP-filter assertion actually reach the DOM.
const HOST_TREE_WITH_RDP: HostFolder = {
  name: "root",
  children: [
    HOST_TREE.children[0],
    {
      ...HOST_TREE.children[0],
      id: "3",
      name: "second-ssh-host",
      ip: "10.0.0.2",
    },
    {
      id: "2",
      name: "windows-box",
      enableRdp: true,
      enableSsh: false,
      enableTerminal: false,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "administrator",
      ip: "10.0.0.99",
      port: 3389,
      folder: "",
      online: true,
      cpu: null,
      ram: null,
      lastAccess: "",
      authType: "password",
      serverTunnels: [],
      quickActions: [],
      sshPort: 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
    },
  ],
};

// Helper: pick a skill in the mounted modal. Awaits the skill dropdown becoming
// enabled (skills list resolved) before firing the change event.
// jsdom lacks ResizeObserver; Radix DropdownMenu (the ⋮ skill menu) needs it.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/** Open the skill view's ⋮ skill menu (sharing, "Rename…", "Delete skill…"). */
async function openSkillMenu(): Promise<void> {
  const trigger = await screen.findByTestId("skills-editor-modal-skill-menu");
  await userEvent.setup().click(trigger);
  await screen.findByRole("menu");
}

async function selectSkill(skillName: string): Promise<void> {
  // The library lists every skill; its row's text opens the skill's own view.
  const open = await screen.findByRole("button", { name: `Open ${skillName}` });
  fireEvent.click(open);
}

/** The skill view starts with its file list collapsed; open it. */
async function openFileList(): Promise<void> {
  const toggle = await screen.findByTestId("skills-editor-modal-files-toggle");
  if (toggle.getAttribute("aria-pressed") !== "true") fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByTestId("skills-editor-modal-file-strip")).not.toHaveClass("hidden"));
}

// ── Test suite ────────────────────────────────────────────────────────────────
describe("SkillsEditorModal — Phase 44 SKILLED-05", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetKitDialogsForTests();
  });

  it("renders the READY textarea after an asynchronous readSkillFile resolves (regression: lazy-load useEffect must not cancel its own in-flight read via tabData-in-deps re-run)", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    // 1. Wait for skill dropdown to be enabled (skills list resolved).
    // 2. Pick "build" — triggers enumerateSkillFiles.
    // 3. Wait for the textarea (auto-selected first tab → readSkillFile).
    await selectSkill("build");

    await waitFor(
      () => expect(screen.queryByRole("textbox")).toBeTruthy(),
      { timeout: 2000 },
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("MOCKED SKILL FILE CONTENT");
  });

  it("host pick triggers listSkills with hostId", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    // defaultHostId auto-selects host 1, which should fire listSkills.
    await waitFor(() => {
      expect(skillsApi.listSkills).toHaveBeenCalled();
    });
    expect(skillsApi.listSkills).toHaveBeenCalledWith(1, { includeDistributed: true });
  });

  it("skill pick triggers enumerateSkillFiles with (hostId, skill)", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");

    await waitFor(() => {
      expect(skillsApi.enumerateSkillFiles).toHaveBeenCalled();
    });
    expect(skillsApi.enumerateSkillFiles).toHaveBeenCalledWith(1, "build");
  });

  it("non-text file → renders the shared can't-preview notice, no textbox", async () => {
    // Override readSkillFile for this test only.
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        content: "",
        mtime: 1_700_000_042,
        size: 4096,
        isText: false,
      };
    });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");

    // Wait for the placeholder heading to appear.
    await waitFor(
      () => expect(screen.queryByText(/can.t preview this file/i)).toBeTruthy(),
      { timeout: 2000 },
    );
    // And critically — NO textbox (the read returned isText: false).
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("+ Add file prompt creates a file and refetches", async () => {
    // Phase 113 D-12/D-13 companion edit: the header-level "+ Add file" button
    // is gone; the same handleAddFile flow is now invoked from the tab-strip
    // "+ New file" action-tab (last child of the tab strip). The prompt round-
    // trip behavior is unchanged; only the trigger surface moved.
    // Second call to enumerateSkillFiles returns the extended list.
    (skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ path: "SKILL.md" }, { path: "tests/basic.py" }])
      .mockResolvedValueOnce([
        { path: "SKILL.md" },
        { path: "tests/basic.py" },
        { path: "new.md" },
      ]);
    const dialogs = autoAnswerKitDialogs({ prompt: "new.md" });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");
    await openFileList();

    await waitFor(() =>
      expect(screen.getByTestId("skills-editor-modal-add-file")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("skills-editor-modal-add-file"));

    await waitFor(() => {
      expect(skillsApi.createSkillFile).toHaveBeenCalledWith(1, "build", "new.md");
    });
    // Second enumerate call after the create.
    await waitFor(() => {
      expect((skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });
    expect(dialogs.calls[0].kind).toBe("prompt");
  });

  // ── Phase 113 D-28: + New skill behavior tests (Task 2 / plan 113-04) ────────
  //
  // Five cases cover the chained-prompt UX register:
  //   (A) chained prompt happy path (name → description) with slugification +
  //       post-create refetch + auto-select of the new skill (D-05).
  //   (B) button disabled when defaultHostId=null on a multi-host tree.
  //   (C) cancel on name prompt aborts the whole flow (no createSkill call).
  //   (D) cancel on description prompt aborts the whole flow (no createSkill call).
  //   (E) empty description re-prompts DESCRIPTION only; the typed name is
  //       retained across the re-prompt (D-04).

  it("+ New skill: chained prompt (name → description) calls createSkill and auto-selects", async () => {
    const answers = ["My Cool Skill" /* name */, "A cool skill." /* description */];
    autoAnswerKitDialogs({ prompt: () => answers.shift() ?? null });

    // createSkill returns the slugified form of the raw name.
    (skillsApi.createSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      slug: "my-cool-skill",
      mtime: 1_700_000_200,
    });
    // listSkills fires TWICE: once on host-pick, again after createSkill success.
    // Second resolution includes the newly-created skill so the picker can
    // auto-select it once setSelectedSkillName(result.slug) fires (D-05).
    (skillsApi.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ name: "build" }, { name: "explain" }])
      .mockResolvedValueOnce([
        { name: "build" },
        { name: "explain" },
        { name: "my-cool-skill" },
      ]);

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^new skill$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^new skill$/i }));

    await waitFor(() => {
      expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-cool-skill", "A cool skill.");
    });

    // Auto-select verification (D-05, WARN 3 fix):
    // listSkills fires twice — once on host-pick, once on post-create refetch.
    await waitFor(() =>
      expect(skillsApi.listSkills).toHaveBeenCalledTimes(2),
    );
    // …and the modal moves into the new skill's own view.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "my-cool-skill" })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("skills-editor-modal-back")).toBeInTheDocument();
  });

  it("+ New skill button is disabled when defaultHostId is null (host not auto-picked)", async () => {
    // Multi-host tree fixture — auto-select effect skips (flatHosts.length > 1),
    // so defaultHostId=null leaves selectedHostId as null and the button is
    // disabled per D-01.
    const multi: HostFolder = {
      name: "root",
      children: [
        HOST_TREE.children[0],
        { ...HOST_TREE.children[0], id: "2", name: "second-host" },
      ],
    };

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={multi}
        defaultHostId={null}
        container={document.body}
      />,
    );

    const btn = screen.getByRole("button", {
      name: /^new skill$/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("+ New skill: cancel on name prompt → no createSkill call, no state change", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: null }); // cancel on the name prompt

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^new skill$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^new skill$/i }));

    // Only one prompt fires (the name); description prompt never fires;
    // createSkill is never called.
    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });

  it("+ New skill: cancel on description prompt → no createSkill call", async () => {
    const answers: Array<string | null> = ["My Skill" /* name — accept */, null /* description — cancel */];
    const dialogs = autoAnswerKitDialogs({ prompt: () => answers.shift() ?? null });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^new skill$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^new skill$/i }));

    // Exactly two prompts fire (name + description); createSkill never called.
    await waitFor(() => expect(dialogs.calls.length).toBe(2));
    expect(skillsApi.createSkill).not.toHaveBeenCalled();
  });

  it("+ New skill: empty description is refused in place; name is retained", async () => {
    // Drives the real kit dialog: the description step refuses a blank value
    // with an inline error (validate) instead of the old alert + re-prompt,
    // and the name typed in step one is kept.
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^new skill$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^new skill$/i }));

    // Step 1 — name (slugifies to "my-skill").
    const nameInput = await screen.findByTestId("kit-prompt-input");
    fireEvent.change(nameInput, { target: { value: "My Skill" } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));

    // Step 2 — description. A blank value is refused with an inline error and
    // the dialog stays open.
    await waitFor(() => expect(screen.getByText(/Describe "My Skill"/)).toBeInTheDocument());
    const descInput = screen.getByTestId("kit-prompt-input");
    fireEvent.change(descInput, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    await waitFor(() =>
      expect(screen.getByText(/description is required/i)).toBeInTheDocument(),
    );
    expect(skillsApi.createSkill).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("kit-prompt-input"), { target: { value: "Fine desc" } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));

    // createSkill is called with the slugified name + the retried description.
    await waitFor(() => {
      expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-skill", "Fine desc");
    });
  });

  it("+ New skill: a name with no letters or numbers is refused in place", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: null });
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^new skill$/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^new skill$/i }));
    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    const validate = (dialogs.calls[0].opts as { validate?: (v: string) => string | null | undefined }).validate!;
    expect(validate("!!!")).toMatch(/at least one letter or number/i);
    expect(validate("My Skill")).toBeFalsy();
  });

  // ── Phase 113 D-28: + New file / single-host / SKILL.md no-delete tests ────
  //
  // Seven cases cover the tab-strip + picker-chrome + delete-affordance
  // dimensions of D-28 that Task 3 owns:
  //   (A) + New file tab is the LAST child of the tab strip (D-13).
  //   (B) + New file tab click does NOT change activeTab (D-14, D-16).
  //   (C) Single-host: host picker <select> is hidden entirely (D-17).
  //   (D) Multi-host (2+ SSH hosts): host picker <select> is visible (D-18).
  //   (E) SKILL.md tab has NO delete (Trash2) affordance (D-10 frontend).
  //   (F) Non-SKILL.md tab retains delete affordance (D-10 frontend).
  //   (H) + New file tab renders in the empty-file-list state and the empty-
  //       state copy points at it (D-15, WARN 4 empty-file-list render).

  it("+ Add file pill is the LAST child of the tab strip", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
    await openFileList();

    // "Add file" sits at the bottom of the file list.
    const strip = screen.getByTestId("skills-editor-modal-file-strip");
    const stripButtons = Array.from(
      strip.querySelectorAll("button"),
    );
    expect(stripButtons.length).toBeGreaterThan(0);
    const last = stripButtons[stripButtons.length - 1];
    expect(last.getAttribute("data-testid")).toBe(
      "skills-editor-modal-add-file",
    );
  });

  it("+ Add file pill click does NOT change activeTab (existing file tab stays selected)", async () => {
    autoAnswerKitDialogs({ prompt: "new-file.md" });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
    await openFileList();

    const addFileBtn = screen.getByTestId("skills-editor-modal-add-file");
    // Capture the pre-click active tab's aria-pressed state to prove the
    // Add-file click did NOT change activeTab.
    const activeBefore = screen
      .getByTestId("skills-editor-modal-tab-SKILL.md")
      .getAttribute("aria-pressed");
    expect(activeBefore).toBe("true");

    fireEvent.click(addFileBtn);
    await waitFor(() => expect(skillsApi.createSkillFile).toHaveBeenCalled());
    // The Add-file pill itself is never the selected tab (no aria-pressed=true).
    expect(addFileBtn.getAttribute("aria-pressed")).not.toBe("true");
  });

  it("single-host: host picker <select> is hidden entirely", async () => {
    // HOST_TREE carries exactly one SSH host → flatHosts.length === 1 →
    // the host <select> is not rendered per D-17. Only the skill combobox
    // remains in the DOM.
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await screen.findByRole("button", { name: "Open build" });
    expect(screen.queryByRole("combobox", { name: /host/i })).toBeNull();
  });

  it("multi-host (2+ SSH hosts): host picker <select> is visible", async () => {
    // Synthesize a fixture with two SSH hosts (both enableSsh=true, neither
    // enableRdp=true) so flatHosts.length === 2 and the picker renders (D-18).
    const multi: HostFolder = {
      name: "root",
      children: [
        HOST_TREE.children[0],
        { ...HOST_TREE.children[0], id: "2", name: "second-host" },
      ],
    };

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={multi}
        defaultHostId={null}
        container={document.body}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /host/i })).toBeTruthy();
  });

  it("SKILL.md tab has NO delete (Trash2) affordance", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    // enumerateSkillFiles returns [SKILL.md, tests/basic.py]; SKILL.md is
    // auto-selected as the first tab (alphabetical). The textbox render
    // proves the SKILL.md tab is active. D-10 frontend: no delete affordance.
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
    expect(screen.queryByTitle(/delete this file/i)).toBeNull();
  });

  it("Non-SKILL.md tab retains delete affordance", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());

    // Switch to tests/basic.py — a non-SKILL.md tab. The Trash2 delete
    // affordance renders because SkillFileTab's D-10 gate only hides the
    // Trash2 button when filename === "SKILL.md".
    await openFileList();
    fireEvent.click(screen.getByTestId("skills-editor-modal-tab-tests/basic.py"));
    await waitFor(() =>
      expect(screen.queryByTitle(/delete this file/i)).toBeTruthy(),
    );
  });

  it("+ Add file: an empty skill offers Add file in its empty state", async () => {
    // Modal-unification 2026-09-29: when the file list is empty, the strip
    // is not rendered (the strip renders only when files.status === "ready"
    // AND there are files to tab through). The empty-state body copy
    // instead names the Add-file pill so users know where to look once
    // they create a file.
    (skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]);

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");

    // Empty-file-list body copy: "This skill has no files."
    await waitFor(() =>
      expect(screen.getByText(/no files/i)).toBeInTheDocument(),
    );
    // The empty state carries its own Add file button.
    expect(screen.getByTestId("skills-editor-modal-add-file")).toBeInTheDocument();
  });

  it("delete-file fires deleteSkillFile after native confirm accepts", async () => {
    // Auto-accept the kit confirm so the delete flow proceeds.
    const dialogs = autoAnswerKitDialogs({ confirm: true });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");
    await waitFor(
      () => expect(screen.queryByRole("textbox")).toBeTruthy(),
      { timeout: 2000 },
    );

    // Phase 113 D-10 companion edit: SKILL.md is auto-selected as the first
    // tab, but SkillFileTab hides its Trash2 affordance for filename ===
    // "SKILL.md". Switch to a non-SKILL.md tab (tests/basic.py) BEFORE
    // triggering the delete flow so the delete affordance renders.
    await openFileList();
    fireEvent.click(screen.getByTestId("skills-editor-modal-tab-tests/basic.py"));
    await waitFor(() =>
      expect(screen.queryByTitle(/delete this file/i)).toBeTruthy(),
    );

    // Click the delete-file Trash2 trigger — the kit confirm auto-accepts
    // via autoAnswerKitDialogs, so the delete API fires immediately.
    fireEvent.click(screen.getByTitle(/delete this file/i));

    await waitFor(() => {
      expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "tests/basic.py");
    });
    expect(dialogs.calls[0].kind).toBe("confirm");
  });

  it("delete-skill fires deleteSkill after native confirm accepts", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });

    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");

    // Delete lives in the skill view's ⋮ menu.
    await openSkillMenu();
    await userEvent.setup().click(
      screen.getByTestId("skills-editor-modal-delete-skill"),
    );

    await waitFor(() => {
      expect(skillsApi.deleteSkill).toHaveBeenCalledWith(1, "build");
    });
    expect(dialogs.calls[0].kind).toBe("confirm");
  });

  it("skill menu holds sharing, rename and delete only — the two settings moved out of it", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    await selectSkill("build");
    await openSkillMenu();

    expect(screen.getByTestId("skills-editor-modal-delete-skill")).toBeInTheDocument();
    expect(screen.getByTestId("skills-editor-modal-rename-skill")).toBeInTheDocument();
    expect(screen.queryByTestId("skills-editor-modal-disable-model-invocation")).toBeNull();
    expect(screen.queryByTestId("skills-editor-modal-agent-invoked-only")).toBeNull();
  });

  const NAMED_SKILL_MD = {
    content: "---\nname: build\n---\n\n# Build\n",
    mtime: 1_700_000_042,
    size: 30,
    isText: true,
  };
  function renderOpen(onOpenChange = vi.fn()) {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={onOpenChange}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    return onOpenChange;
  }
  async function editNameTo(newName: string): Promise<void> {
    const editor = (await screen.findByRole("textbox", {}, { timeout: 5000 })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: editor.value.replace("name: build", `name: ${newName}`) } });
    await waitFor(() => expect(screen.getByTestId("skills-editor-modal-save")).not.toBeDisabled(), { timeout: 5000 });
    fireEvent.click(screen.getByTestId("skills-editor-modal-save"));
  }

  it("Rename… slugs the new name, moves the skill and reopens it under that name", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "Ship It" });
    renderOpen();
    await selectSkill("build");
    (skillsApi.listSkills as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ name: "ship-it" }, { name: "explain" }]);
    await openSkillMenu();
    await userEvent.setup().click(screen.getByTestId("skills-editor-modal-rename-skill"));

    await waitFor(() => expect(skillsApi.renameSkill).toHaveBeenCalledWith(1, "build", "ship-it", undefined));
    expect(dialogs.calls[0].kind).toBe("prompt");
    await waitFor(() => expect(screen.getAllByRole("heading")[0]).toHaveTextContent("ship-it"));
    await waitFor(() => expect(skillsApi.enumerateSkillFiles).toHaveBeenLastCalledWith(1, "ship-it"));
  });

  it("Rename… to a name that's taken says so and stays on the skill", async () => {
    (skillsApi.renameSkill as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new skillsApi.SkillAlreadyExistsError());
    const dialogs = autoAnswerKitDialogs({ prompt: "explain" });
    renderOpen();
    await selectSkill("build");
    await openSkillMenu();
    await userEvent.setup().click(screen.getByTestId("skills-editor-modal-rename-skill"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(screen.getAllByRole("heading")[0]).toHaveTextContent("build");
  });

  it("saving SKILL.md with a changed name offers the rename, and the draft rides along", async () => {
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NAMED_SKILL_MD);
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderOpen();
    await selectSkill("build");
    await editNameTo("ship");
    await waitFor(() =>
      expect(skillsApi.renameSkill).toHaveBeenCalledWith(1, "build", "ship", {
        content: "---\nname: ship\n---\n\n# Build\n",
        expectedMtime: 1_700_000_042,
      }),
    );
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(skillsApi.writeSkillFile).not.toHaveBeenCalled();
  });

  it("SKILL.md name change: Cancel saves nothing and closing still asks about the edits", async () => {
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NAMED_SKILL_MD);
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const onOpenChange = renderOpen();
    await selectSkill("build");
    await editNameTo("ship");
    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(skillsApi.renameSkill).not.toHaveBeenCalled();
    expect(skillsApi.writeSkillFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("skills-editor-modal-close-foot"));
    await waitFor(() => expect(dialogs.calls.length).toBe(2));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("SKILL.md name that can't be a skill name is refused with a note", async () => {
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(NAMED_SKILL_MD);
    const dialogs = autoAnswerKitDialogs({});
    renderOpen();
    await selectSkill("build");
    await editNameTo("Ship It");
    await waitFor(() => expect(dialogs.calls[0]?.kind).toBe("alert"));
    expect(skillsApi.renameSkill).not.toHaveBeenCalled();
    expect(skillsApi.writeSkillFile).not.toHaveBeenCalled();
  });

  it("RDP-only hosts are filtered from the host <select>", async () => {
    // Phase 113 D-17 companion edit: HOST_TREE_WITH_RDP now carries a second
    // SSH host so flatHosts.length > 1 after filtering — otherwise the
    // single-host picker-hide short-circuits this test's assertion.
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE_WITH_RDP}
        defaultHostId={null}
        container={document.body}
      />,
    );

    // Host <select> has combobox role (radix); find the host one specifically.
    const hostSelect = screen.getByRole("combobox", { name: /host/i });
    // Assert both SSH hosts are present as options, and the RDP-only host is NOT.
    expect(within(hostSelect).queryByText("thenasty")).toBeTruthy();
    expect(within(hostSelect).queryByText("second-ssh-host")).toBeTruthy();
    expect(within(hostSelect).queryByText("windows-box")).toBeNull();
  });
  // ── Library: who can use which skill, at a glance ─────────────────────────

  const LIB_SKILLS = [
    { name: "build", description: "Builds things" },
    { name: "call-me", userInvocable: undefined, modelInvocable: false as const },
    { name: "gmail", userInvocable: false as const },
    { name: "parked", userInvocable: false as const, modelInvocable: false as const },
    { name: "stt", description: "Transcribe", distributed: true as const },
  ];

  function renderLibrary(): void {
    (skillsApi.listSkills as ReturnType<typeof vi.fn>).mockResolvedValue(LIB_SKILLS);
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
  }

  it("library: every skill shows a You and an Agents switch matching its settings", async () => {
    renderLibrary();
    await screen.findByRole("button", { name: "Open build" });

    const sw = (which: string, name: string) =>
      screen.getByTestId(`skills-editor-modal-switch-${which}-${name}`) as HTMLInputElement;
    expect(sw("you", "build").checked).toBe(true);
    expect(sw("agents", "build").checked).toBe(true);
    expect(sw("you", "call-me").checked).toBe(true);
    expect(sw("agents", "call-me").checked).toBe(false);
    expect(sw("you", "gmail").checked).toBe(false);
    expect(sw("agents", "gmail").checked).toBe(true);
    // A skill already set to "nobody" on disk is flagged.
    expect(screen.getByTestId("skills-editor-modal-nobody-parked")).toHaveTextContent("Nobody can use this");
  });

  it("library: fleet-distributed skills get their own read-only section with fixed marks", async () => {
    renderLibrary();
    const sectionEl = await screen.findByTestId("skills-editor-modal-section-distributed");
    expect(within(sectionEl).getByText(/Installed on every machine from the Skynet repo/)).toBeInTheDocument();
    expect(screen.queryByTestId("skills-editor-modal-switch-you-stt")).toBeNull();
    expect(screen.getByTestId("skills-editor-modal-mark-you-stt")).toBeInTheDocument();
    expect(screen.getByTestId("skills-editor-modal-mark-agents-stt")).toBeInTheDocument();
  });

  it("library: the filter counts and narrows — You leaves out agent-only and distributed skills", async () => {
    renderLibrary();
    await screen.findByRole("button", { name: "Open build" });
    // All 5 · You: build, call-me (stt is distributed, gmail/parked off) = 2 · Agents: build, gmail, stt = 3
    expect(screen.getByTestId("skills-editor-modal-filter-all")).toHaveTextContent("All 5");
    expect(screen.getByTestId("skills-editor-modal-filter-you")).toHaveTextContent("You 2");
    expect(screen.getByTestId("skills-editor-modal-filter-agents")).toHaveTextContent("Agents 3");

    fireEvent.click(screen.getByTestId("skills-editor-modal-filter-you"));
    expect(screen.getByRole("button", { name: "Open build" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open gmail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open stt" })).toBeNull();

    fireEvent.click(screen.getByTestId("skills-editor-modal-filter-all"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), { target: { value: "transcr" } });
    expect(screen.getByRole("button", { name: "Open stt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open build" })).toBeNull();
  });

  it("library: flipping a switch rewrites that skill's SKILL.md without opening it", async () => {
    const seed = '---\nname: build\ndescription: "Builds"\n---\n\n# Build\n';
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: seed,
      mtime: 1_700_000_042,
      size: seed.length,
      isText: true,
    });
    renderLibrary();
    await screen.findByRole("button", { name: "Open build" });

    fireEvent.click(screen.getByTestId("skills-editor-modal-switch-agents-build"));

    await waitFor(() => {
      expect(skillsApi.writeSkillFile).toHaveBeenCalledWith({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
        content: '---\nname: build\ndescription: "Builds"\ndisable-model-invocation: true\n---\n\n# Build\n',
        expectedMtime: 1_700_000_042,
      });
    });
    expect(skillsApi.readSkillFile).toHaveBeenCalledWith(1, "build", "SKILL.md");
    // Still in the library, switch now off, counts follow.
    expect((screen.getByTestId("skills-editor-modal-switch-agents-build") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("skills-editor-modal-filter-agents")).toHaveTextContent("Agents 2");
    expect(skillsApi.enumerateSkillFiles).not.toHaveBeenCalled();
  });

  it("library: turning off a skill's last switch is refused", async () => {
    renderLibrary();
    await screen.findByRole("button", { name: "Open call-me" });

    // call-me: You on, Agents off — You is the last one on.
    fireEvent.click(screen.getByTestId("skills-editor-modal-switch-you-call-me"));

    expect(await screen.findByText(/One of these has to stay on/)).toBeInTheDocument();
    expect((screen.getByTestId("skills-editor-modal-switch-you-call-me") as HTMLInputElement).checked).toBe(true);
    expect(skillsApi.readSkillFile).not.toHaveBeenCalled();
    expect(skillsApi.writeSkillFile).not.toHaveBeenCalled();
  });

  it("library: a failed write puts the switch back and says so", async () => {
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "---\nname: build\n---\n",
      mtime: 1,
      size: 1,
      isText: true,
    });
    (skillsApi.writeSkillFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("SSH connect failed"));
    const dialogs = autoAnswerKitDialogs({});
    renderLibrary();
    await screen.findByRole("button", { name: "Open build" });

    fireEvent.click(screen.getByTestId("skills-editor-modal-switch-you-build"));

    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    await waitFor(() =>
      expect((screen.getByTestId("skills-editor-modal-switch-you-build") as HTMLInputElement).checked).toBe(true),
    );
  });

  // ── Skill view ────────────────────────────────────────────────────────────

  it("skill view opens on SKILL.md with the file list collapsed, even when SKILL.md isn't first", async () => {
    (skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { path: "README.md" },
      { path: "SKILL.md" },
      { path: "scripts/run.sh" },
    ]);
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");

    await waitFor(() =>
      expect(screen.getByTestId("skills-editor-modal-current-file")).toHaveTextContent("SKILL.md"),
    );
    expect(screen.getByTestId("skills-editor-modal-file-strip")).toHaveClass("hidden");
    expect(screen.getByTestId("skills-editor-modal-files-toggle")).toHaveTextContent("3 files");

    await openFileList();
    const strip = screen.getByTestId("skills-editor-modal-file-strip");
    expect(within(strip).getByText("scripts/")).toBeInTheDocument();
    expect(within(strip).getByText("run.sh")).toBeInTheDocument();
  });

  it("skill view: the two settings are switches under the header and write SKILL.md", async () => {
    const seed = "---\nname: build\n---\n\n# Build\n";
    (skillsApi.readSkillFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: seed,
      mtime: 1_700_000_043,
      size: seed.length,
      isText: true,
    });
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    const you = await screen.findByTestId("skills-editor-modal-switch-you-build");
    await waitFor(() => expect(you).not.toBeDisabled());

    fireEvent.click(you);
    await waitFor(() => {
      expect(skillsApi.writeSkillFile).toHaveBeenCalledWith({
        hostId: 1,
        skill: "build",
        path: "SKILL.md",
        content: "---\nname: build\nuser-invocable: false\n---\n\n# Build\n",
        expectedMtime: 1_700_000_043,
      });
    });
    // Back in the library the row reflects it.
    fireEvent.click(screen.getByTestId("skills-editor-modal-back"));
    await waitFor(() =>
      expect((screen.getByTestId("skills-editor-modal-switch-you-build") as HTMLInputElement).checked).toBe(false),
    );
  });

  it("skill view: switches wait while SKILL.md has unsaved edits", async () => {
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "edited" } });

    await waitFor(() =>
      expect(screen.getByTestId("skills-editor-modal-switch-you-build")).toBeDisabled(),
    );
    expect(screen.getByText("Save or discard your edits first")).toBeInTheDocument();
  });

  it("skill view: going back with unsaved edits asks first", async () => {
    const answers = [false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? true });
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "edited" } });

    // Cancel: stays in the skill.
    fireEvent.click(screen.getByTestId("skills-editor-modal-back"));
    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(screen.getByTestId("skills-editor-modal-back")).toBeInTheDocument();

    // Discard: back to the library.
    fireEvent.click(screen.getByTestId("skills-editor-modal-back"));
    expect(await screen.findByRole("button", { name: "Open build" })).toBeInTheDocument();
    expect(dialogs.calls[1].kind).toBe("confirm");
  });

  it("skill view: switching file with unsaved edits asks first", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "edited" } });

    await openFileList();
    fireEvent.click(screen.getByTestId("skills-editor-modal-tab-tests/basic.py"));

    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(screen.getByTestId("skills-editor-modal-current-file")).toHaveTextContent("SKILL.md");
  });

  it("skill view: after a Save, closing with new unsaved edits still asks first", async () => {
    const onOpenChange = vi.fn();
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={onOpenChange}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "first edit" } });
    await waitFor(() => expect(screen.getByTestId("skills-editor-modal-save")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("skills-editor-modal-save"));
    await waitFor(() => expect(skillsApi.writeSkillFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("skills-editor-modal-save")).toBeDisabled());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "second edit" } });
    await waitFor(() => expect(screen.getByTestId("skills-editor-modal-save")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("skills-editor-modal-close-foot"));

    await waitFor(() => expect(dialogs.calls.length).toBe(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("skill view: top-level files list before folders, so no file sits under the wrong folder", async () => {
    (skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { path: "SKILL.md" },
      { path: "examples/a.md" },
      { path: "reference.md" },
    ]);
    render(
      <SkillsEditorModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );
    await selectSkill("build");
    await openFileList();
    const strip = screen.getByTestId("skills-editor-modal-file-strip");
    const order = Array.from(strip.querySelectorAll(".k-side-head, [data-testid^='skills-editor-modal-tab-']")).map(
      (el) => el.textContent,
    );
    expect(order).toEqual(["SKILL.md", "reference.md", "examples/", "a.md"]);
  });
});
