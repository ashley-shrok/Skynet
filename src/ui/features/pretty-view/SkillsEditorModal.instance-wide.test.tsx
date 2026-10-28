/**
 * SkillsEditorModal — "Shared to every host" (instance-wide) and fleet-distributed
 * sections (shape-instance-wide-roles-and-skills, shape-skills-modal).
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

vi.mock("@/api/instance-wide-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listInstanceWide: vi.fn(),
    previewPromote: vi.fn().mockResolvedValue({
      files: 2,
      bytes: 2048,
      tooLarge: false,
      clashes: ["beta"],
      unreachable: [],
      sourceHostName: "thenasty",
    }),
    promote: vi.fn().mockResolvedValue(undefined),
    removeInstanceWide: vi.fn().mockResolvedValue({ hostCount: 3 }),
  };
});

// ── Late imports (after mocks are registered) ────────────────────────────────
import SkillsEditorModal from "./SkillsEditorModal";
import * as skillsApi from "@/api/skills-api";
import * as iwApi from "@/api/instance-wide-api";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

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

/** Open the skill view's ⋮ menu (share / remove / delete). */
async function openSkillMenu(): Promise<void> {
  const trigger = await screen.findByTestId("skills-editor-modal-skill-menu");
  await userEvent.setup().click(trigger);
  await screen.findByRole("menu");
}

async function selectSkill(skillName: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: `Open ${skillName}` }));
}

// ── Test suite ────────────────────────────────────────────────────────────────

const IW_ITEM = {
  kind: "skill" as const,
  name: "shared-skill",
  description: "shared",
  updatedAt: 1,
  behind: 1,
  conflicts: 0,
  hostCount: 3,
  hosts: [
    { machineId: "1", hostName: "thenasty", state: "current" as const },
    { machineId: "2", hostName: "laptop", state: "behind" as const, detail: "unreachable since 2pm" },
  ],
};

function renderModal(): void {
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

describe("SkillsEditorModal — shared to every host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetKitDialogsForTests();
  });

  it("admin: shared skills have their own section and edit the master copy (hostId 0)", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [IW_ITEM] });
    renderModal();
    const sectionEl = await screen.findByTestId("skills-editor-modal-section-shared");
    expect(within(sectionEl).getByText("Shared to every host")).toBeInTheDocument();
    expect(within(sectionEl).getByRole("button", { name: "Open shared-skill" })).toBeInTheDocument();
    await selectSkill("shared-skill");
    await waitFor(() =>
      expect(skillsApi.enumerateSkillFiles).toHaveBeenCalledWith(0, "shared-skill"),
    );
    // Quiet status: one host behind → warning chip with detail on click.
    const warn = await screen.findByTestId("instance-wide-sync-warning");
    expect(warn).toHaveTextContent("1 host behind");
    fireEvent.click(warn);
    expect(screen.getByTestId("instance-wide-sync-detail")).toHaveTextContent("laptop");
  });

  it("admin: a shared skill also present in the host's folder shows only in the shared section", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [IW_ITEM] });
    vi.mocked(skillsApi.listSkills).mockResolvedValueOnce([{ name: "build" }, { name: "shared-skill", shared: true }]);
    renderModal();
    const shared = await screen.findByTestId("skills-editor-modal-section-shared");
    const own = await screen.findByTestId("skills-editor-modal-section-own");
    expect(within(shared).getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open shared-skill",
    ]);
    expect(within(own).getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open build",
    ]);
  });

  it("admin: a shared skill's switches write its master copy", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [IW_ITEM] });
    vi.mocked(skillsApi.readSkillFile).mockResolvedValue({ content: "---\nname: shared-skill\n---\n", mtime: 7, size: 1, isText: true });
    renderModal();
    await screen.findByRole("button", { name: "Open shared-skill" });
    fireEvent.click(screen.getByTestId("skills-editor-modal-switch-agents-shared-skill"));
    await waitFor(() =>
      expect(skillsApi.writeSkillFile).toHaveBeenCalledWith({
        hostId: 0,
        skill: "shared-skill",
        path: "SKILL.md",
        content: "---\nname: shared-skill\ndisable-model-invocation: true\n---\n",
        expectedMtime: 7,
      }),
    );
  });

  it("shows no warning when every host is current", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({
      isAdmin: true,
      items: [{ ...IW_ITEM, behind: 0, hosts: [IW_ITEM.hosts[0]] }],
    });
    renderModal();
    await selectSkill("shared-skill");
    await screen.findByTestId("skills-editor-modal-switch-you-shared-skill");
    expect(screen.queryByTestId("instance-wide-sync-warning")).toBeNull();
  });

  it("admin: Share to every host previews, warns, and promotes", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await selectSkill("build");
    await openSkillMenu();
    await userEvent.setup().click(screen.getByTestId("skills-editor-modal-promote-skill"));
    await waitFor(() => expect(iwApi.promote).toHaveBeenCalledWith("skill", "build", 1));
    expect(iwApi.previewPromote).toHaveBeenCalledWith("skill", "build", 1);
    const opts = dialogs.calls[0].opts;
    const text = `${String(opts.title)}\n${String(opts.body)}`;
    expect(text).toMatch(/every host/);
    expect(text).toMatch(/beta/);
  });

  it("admin: a shared skill's Delete skill… says it deletes it from every host, with the host count", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [IW_ITEM] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await selectSkill("shared-skill");
    await openSkillMenu();
    expect(screen.queryByTestId("skills-editor-modal-delete-skill")).toBeNull();
    expect(screen.getByTestId("skills-editor-modal-remove-instance-skill").textContent).toContain("Delete skill…");
    await userEvent.setup().click(screen.getByTestId("skills-editor-modal-remove-instance-skill"));
    await waitFor(() => expect(iwApi.removeInstanceWide).toHaveBeenCalledWith("skill", "shared-skill"));
    expect(dialogs.calls[0].opts.title).toBe('Delete "shared-skill" from every host?');
    expect(String(dialogs.calls[0].opts.body)).toMatch(/all 3 hosts/);
    expect((dialogs.calls[0].opts as { confirmLabel?: string }).confirmLabel).toBe("Delete everywhere");
  });

  it("non-admin: sees the shared section, read-only (marks, not switches)", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: false, items: [IW_ITEM] });
    renderModal();
    const shared = await screen.findByTestId("skills-editor-modal-section-shared");
    expect(within(shared).getByRole("button", { name: "Open shared-skill" })).toBeTruthy();
    expect(screen.queryByTestId("skills-editor-modal-switch-agents-shared-skill")).toBeNull();
    expect(screen.getByTestId("skills-editor-modal-mark-agents-shared-skill")).toBeTruthy();
  });

  it("non-admin on a host outside sync: a same-named skill is their own", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: false, items: [IW_ITEM] });
    vi.mocked(skillsApi.listSkills).mockResolvedValueOnce([{ name: "build" }, { name: "shared-skill" }]);
    renderModal();
    const own = await screen.findByTestId("skills-editor-modal-section-own");
    expect(within(own).getByRole("button", { name: "Open shared-skill" })).toBeTruthy();
  });

  it("non-admin: no Share to every host on their own skills", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: false, items: [] });
    renderModal();
    await selectSkill("build");
    await openSkillMenu();
    expect(screen.queryByTestId("skills-editor-modal-promote-skill")).toBeNull();
  });
});

describe("SkillsEditorModal — fleet-distributed section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [] });
    vi.mocked(skillsApi.listSkills).mockResolvedValue([
      { name: "build" },
      { name: "stt", description: "Transcribe", distributed: true },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetKitDialogsForTests();
  });

  it("asks for distributed skills and lists them in their own section", async () => {
    renderModal();
    const dist = await screen.findByTestId("skills-editor-modal-section-distributed");
    expect(skillsApi.listSkills).toHaveBeenCalledWith(1, { includeDistributed: true });
    expect(within(dist).getByText("Fleet-distributed — read-only")).toBeInTheDocument();
    expect(within(dist).getByRole("button", { name: "Open stt" })).toBeInTheDocument();
    const own = screen.getByTestId("skills-editor-modal-section-own");
    expect(within(own).queryByRole("button", { name: "Open stt" })).toBeNull();
  });

  it("a distributed skill is read-only: banner, no switches, no add file, no delete, no promote", async () => {
    renderModal();
    await selectSkill("stt");
    await waitFor(() => expect(skillsApi.enumerateSkillFiles).toHaveBeenCalledWith(1, "stt"));
    expect(screen.getByTestId("skills-editor-modal-readonly-banner")).toHaveTextContent(/Skynet repo/);
    expect(screen.queryByTestId("skills-editor-modal-switch-you-stt")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Loading files…")).toBeNull());
    expect(screen.queryByTestId("skills-editor-modal-add-file")).toBeNull();
    expect(screen.queryByTestId("skills-editor-modal-save")).toBeNull();
    expect(screen.getByTestId("skills-editor-modal-close-foot")).toBeInTheDocument();
    // The editor itself is view-only, so nothing can go dirty.
    expect(await screen.findByTestId("mdxeditor")).toBeDisabled();
    await openSkillMenu();
    expect(screen.getByTestId("skills-editor-modal-distributed-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("skills-editor-modal-delete-skill")).toBeNull();
    expect(screen.queryByTestId("skills-editor-modal-promote-skill")).toBeNull();
  });

  it("the host's own skills stay editable", async () => {
    renderModal();
    await selectSkill("build");
    await waitFor(() => expect(skillsApi.enumerateSkillFiles).toHaveBeenCalledWith(1, "build"));
    expect(screen.queryByTestId("skills-editor-modal-readonly-banner")).toBeNull();
    await openSkillMenu();
    expect(screen.getByTestId("skills-editor-modal-delete-skill")).toBeInTheDocument();
  });
});
