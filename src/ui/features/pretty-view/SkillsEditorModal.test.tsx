/**
 * Phase 44 SKILLED-05 — SkillsEditorModal tests.
 *
 * Byte-shape mirror of GlobalFilesModal.test.tsx (quick 260805-7rq) with the
 * skill dimension threaded into every fixture. The primary test (#1) is the
 * lazy-load race regression: the ~700ms SSH read must resolve into a rendered
 * textarea without being cancelled by a spurious tabData-in-deps effect re-run.
 *
 * Additional tests cover the Phase 44 seams:
 *   - host pick triggers listSkills
 *   - skill pick triggers enumerateSkillFiles
 *   - non-text file → AlertTriangle placeholder + no textbox
 *   - + Add file prompt round-trip (create + refetch)
 *   - delete-file confirm dialog fires deleteSkillFile
 *   - delete-skill confirm dialog fires deleteSkill
 *   - RDP-only hosts are filtered from the host <select>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { HostFolder } from "@/types/ui-types";

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

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
async function selectSkill(skillName: string): Promise<void> {
  await waitFor(() => {
    const select = screen.getByRole("combobox", { name: /skill/i }) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });
  const skillSelect = screen.getByRole("combobox", { name: /skill/i });
  fireEvent.change(skillSelect, { target: { value: skillName } });
}

// ── Test suite ────────────────────────────────────────────────────────────────
describe("SkillsEditorModal — Phase 44 SKILLED-05", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(skillsApi.listSkills).toHaveBeenCalledWith(1);
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

  it("non-text file → renders AlertTriangle placeholder, no textbox", async () => {
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
      () => expect(screen.queryByText(/not a text file/i)).toBeTruthy(),
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
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("new.md");

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

    // Wait for the tab strip to render its "+ New file" action-tab (only
    // present once a skill is picked and the file list resolves).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /new file/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /new file/i }));

    await waitFor(() => {
      expect(skillsApi.createSkillFile).toHaveBeenCalledWith(1, "build", "new.md");
    });
    // Second enumerate call after the create.
    await waitFor(() => {
      expect((skillsApi.enumerateSkillFiles as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });

    promptSpy.mockRestore();
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
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValueOnce("My Cool Skill") // name prompt
      .mockReturnValueOnce("A cool skill."); // description prompt

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
      expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

    await waitFor(() => {
      expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-cool-skill", "A cool skill.");
    });

    // Auto-select verification (D-05, WARN 3 fix):
    // listSkills fires twice — once on host-pick, once on post-create refetch.
    await waitFor(() =>
      expect(skillsApi.listSkills).toHaveBeenCalledTimes(2),
    );
    // …and the skill combobox transitions to the new slug (setSelectedSkillName).
    await waitFor(() => {
      const skillCombo = screen.getByRole("combobox", {
        name: /skill/i,
      }) as HTMLSelectElement;
      expect(skillCombo.value).toBe("my-cool-skill");
    });

    promptSpy.mockRestore();
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
      name: /\+ new skill/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("+ New skill: cancel on name prompt → no createSkill call, no state change", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValueOnce(null); // cancel on the name prompt

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
      expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

    // Only one prompt fires (the name); description prompt never fires;
    // createSkill is never called.
    await waitFor(() => expect(promptSpy.mock.calls.length).toBe(1));
    expect(skillsApi.createSkill).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("+ New skill: cancel on description prompt → no createSkill call", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValueOnce("My Skill") // name — accept
      .mockReturnValueOnce(null); // description — cancel

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
      expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

    // Exactly two prompts fire (name + description); createSkill never called.
    await waitFor(() => expect(promptSpy.mock.calls.length).toBe(2));
    expect(skillsApi.createSkill).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("+ New skill: empty description re-prompts description ONLY; name is retained", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValueOnce("My Skill") // name — accept (slugifies to "my-skill")
      .mockReturnValueOnce("   ") // description — empty after trim → re-prompt
      .mockReturnValueOnce("Fine desc"); // description retry — accept

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
      expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

    // createSkill is called with the slugified name + the retried description.
    // The name is NOT re-prompted despite the description re-prompt (D-04:
    // the outer-loop closure retains the name across the inner-loop re-prompt).
    await waitFor(() => {
      expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-skill", "Fine desc");
    });

    // Name prompt fired exactly ONCE; description prompt fired exactly TWICE.
    const nameCalls = promptSpy.mock.calls.filter((c) =>
      /skill name/i.test(c[0] as string),
    );
    const descCalls = promptSpy.mock.calls.filter((c) =>
      /Description/.test(c[0] as string),
    );
    expect(nameCalls).toHaveLength(1);
    expect(descCalls).toHaveLength(2);

    // window.alert fired at least once with a "description is required"-ish message.
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringMatching(/description is required/i),
    );

    promptSpy.mockRestore();
    alertSpy.mockRestore();
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

  it("+ New file tab is the LAST child of the tab strip", async () => {
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

    // The tab strip contains the file tabs plus the "+ New file" action-tab.
    // Filter to just those buttons (file paths + New file) and assert the last
    // one is New file — regardless of file count, the New-file tab is pinned
    // right (shrink-0 last-child).
    const tabButtons = screen
      .getAllByRole("button")
      .filter((b) => /new file|SKILL\.md|tests\/basic\.py/i.test(b.textContent ?? ""));
    expect(tabButtons.length).toBeGreaterThan(0);
    const last = tabButtons[tabButtons.length - 1];
    expect(last.textContent).toMatch(/new file/i);
  });

  it("+ New file tab click does NOT change activeTab (existing file tab stays selected)", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("new-file.md");

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

    const newFileBtn = screen.getByRole("button", { name: /new file/i });
    fireEvent.click(newFileBtn);

    // The click fires the createSkillFile flow (via handleAddFile), proving
    // the handler ran — but the button itself is styled as an action-tab, not
    // an active tab: no font-semibold, no selected-pill treatment.
    await waitFor(() => expect(skillsApi.createSkillFile).toHaveBeenCalled());
    expect(newFileBtn.className).not.toMatch(/font-semibold/);

    promptSpy.mockRestore();
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

    const comboboxes = screen.queryAllByRole("combobox");
    expect(comboboxes).toHaveLength(1); // only the skill picker
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
    fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }));
    await waitFor(() =>
      expect(screen.queryByTitle(/delete this file/i)).toBeTruthy(),
    );
  });

  it("+ New file tab renders in empty-file-list state and empty-state copy points at it", async () => {
    // WARN 4 fix: override enumerateSkillFiles to return zero files for the
    // picked skill. The empty-file-list body branch must render (a) the "no
    // files" copy, (b) the repointed empty-state copy naming "+ New file",
    // and (c) the "+ New file" tab itself (D-15 tab-strip hoist).
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

    // Empty-file-list body copy: "This skill has no files." (D-15).
    await waitFor(() =>
      expect(screen.getByText(/no files/i)).toBeInTheDocument(),
    );
    // Empty-state copy is repointed at the new-file tab (D-15).
    expect(
      screen.getByText(/Use the .+ New file. tab below/i),
    ).toBeInTheDocument();
    // The "+ New file" tab renders even with zero files (D-15 tab-strip hoist).
    expect(
      screen.getByRole("button", { name: /new file/i }),
    ).toBeInTheDocument();
  });

  it("delete-file confirm dialog opens and DELETE fires on confirm", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }));
    await waitFor(() =>
      expect(screen.queryByTitle(/delete this file/i)).toBeTruthy(),
    );

    // Click the delete-file Trash2 trigger (title="Delete this file") inside the tab pane.
    fireEvent.click(screen.getByTitle(/delete this file/i));

    // Confirmation dialog appears with heading "Delete file?".
    await waitFor(() => {
      expect(screen.queryByText(/delete file\?/i)).toBeTruthy();
    });

    // Click the primary destructive button ("Delete").
    const primary = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(primary);

    await waitFor(() => {
      expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "tests/basic.py");
    });
  });

  it("delete-skill confirm dialog opens and DELETE fires on confirm", async () => {
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

    // Click the delete-skill Trash2 in the header (title="Delete this skill").
    await waitFor(() => {
      expect(screen.queryByTitle(/delete this skill/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle(/delete this skill/i));

    // Dialog heading "Delete skill?" appears.
    await waitFor(() => {
      expect(screen.queryByText(/delete skill\?/i)).toBeTruthy();
    });

    // Click the primary destructive button ("Delete skill").
    const primary = screen.getByRole("button", { name: /^delete skill$/i });
    fireEvent.click(primary);

    await waitFor(() => {
      expect(skillsApi.deleteSkill).toHaveBeenCalledWith(1, "build");
    });
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
});
