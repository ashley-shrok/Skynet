// Shared API mocks for the roles-window test suites.
//
// Each suite registers its own (hoisted) vi.mock calls and points the
// factories here, e.g.
//   vi.mock("@/api/identities-api", async (orig) =>
//     (await import("./roles-window.test-mocks")).identitiesApi(orig));
// This module imports nothing from the app, so a factory can load it while
// the module it is mocking is still pending.

import { vi } from "vitest";

type Orig = () => Promise<unknown>;
const spread = async (orig: Orig): Promise<Record<string, unknown>> => (await orig()) as Record<string, unknown>;

export const m = {
  // identities-api
  listRolesForHost: vi.fn(),
  updateRoleAvatarByName: vi.fn(),
  createRole: vi.fn(),
  postGenerateAvatarBatch: vi.fn(),
  postManualAvatarCandidate: vi.fn(),
  // instance-wide-api
  listInstanceWide: vi.fn(),
  previewPromote: vi.fn(),
  promote: vi.fn(),
  removeInstanceWide: vi.fn(),
  // archive / un-archive
  listArchivedRoles: vi.fn(),
  unarchiveRole: vi.fn(),
  archiveRole: vi.fn(),
  // role file
  getRoleFileByName: vi.fn(),
  updateRoleFileByName: vi.fn(),
  // runbooks-api
  listRunbooks: vi.fn(),
  enumerateRunbookFiles: vi.fn(),
  readRunbookFile: vi.fn(),
  writeRunbookFile: vi.fn(),
  writeRunbookFileBinary: vi.fn(),
  createRunbookFile: vi.fn(),
  deleteRunbookFile: vi.fn(),
  deleteRunbook: vi.fn(),
  createRunbook: vi.fn(),
  renameRunbook: vi.fn(),
  // files / git / voice
  listWorkspace: vi.fn(),
  hasGitRepos: vi.fn(),
  fetchVoiceCatalog: vi.fn(),
  postSpeak: vi.fn(),
};

/** The agents the identities store reports (mutate per test). */
export const store: { identities: Array<Record<string, unknown>> } = { identities: [] };

export const DEFAULT_ROLE_FILE = "---\ndisplayName: Box Maintainer\ncolorHue: '320'\n---\n\n# Box Maintainer\n\nKeeps the box healthy.\n";

/** Defaults every suite starts from; tests override per case. */
export function resetRolesWindowMocks(): void {
  for (const fn of Object.values(m)) fn.mockReset();
  store.identities = [];
  m.listRolesForHost.mockResolvedValue([]);
  m.updateRoleAvatarByName.mockResolvedValue({ filename: "box-maintainer.png", avatarUrl: "/x" });
  m.createRole.mockResolvedValue({ name: "meal-planner", description: "d", cosmetics: {} });
  m.postGenerateAvatarBatch.mockResolvedValue([
    { id: "c1", url: "https://img.example/c1.webp" },
    { id: "c2", url: "https://img.example/c2.webp" },
    { id: "c3", url: "https://img.example/c3.webp" },
  ]);
  m.postManualAvatarCandidate.mockResolvedValue({ id: "manual-1" });
  m.listInstanceWide.mockResolvedValue({ isAdmin: false, items: [] });
  m.previewPromote.mockResolvedValue({
    files: 3,
    bytes: 4096,
    tooLarge: false,
    clashes: [],
    unreachable: [],
    sourceHostName: "thenasty",
  });
  m.promote.mockResolvedValue(undefined);
  m.removeInstanceWide.mockResolvedValue({ hostCount: 4 });
  m.listArchivedRoles.mockResolvedValue([]);
  m.unarchiveRole.mockResolvedValue({ ok: true });
  m.archiveRole.mockResolvedValue({ ok: true });
  m.getRoleFileByName.mockResolvedValue({ markdown: DEFAULT_ROLE_FILE });
  m.updateRoleFileByName.mockImplementation(async (_name: string, _hostId: number, markdown: string) => ({ markdown }));
  m.listRunbooks.mockResolvedValue([]);
  m.enumerateRunbookFiles.mockResolvedValue([]);
  m.readRunbookFile.mockResolvedValue({ content: "", mtime: 1, size: 0, isText: true });
  m.writeRunbookFile.mockResolvedValue({ mtime: 2 });
  m.writeRunbookFileBinary.mockResolvedValue({ mtime: 2 });
  m.createRunbookFile.mockResolvedValue({ path: "new.md", mtime: 1 });
  m.deleteRunbookFile.mockResolvedValue(undefined);
  m.deleteRunbook.mockResolvedValue(undefined);
  m.createRunbook.mockResolvedValue({ path: "runbook.md", mtime: 5 });
  m.renameRunbook.mockImplementation(async (_h: number, _r: string, _rb: string, newName: string) => ({ name: newName }));
  m.listWorkspace.mockResolvedValue({ entries: [], path: "" });
  m.hasGitRepos.mockResolvedValue(false);
  m.fetchVoiceCatalog.mockResolvedValue({
    voices: ["Danielle", "Joanna", "Matthew"].map((id) => ({ id, name: id })),
    defaultVoice: "Joanna",
    listError: false,
  });
  m.postSpeak.mockResolvedValue(new Blob(["x"], { type: "audio/mp3" }));
}

// ── vi.mock factories ────────────────────────────────────────────────────────

export async function identitiesApi(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    listRolesForHost: (...a: unknown[]) => m.listRolesForHost(...a),
    updateRoleAvatarByName: (...a: unknown[]) => m.updateRoleAvatarByName(...a),
    createRole: (...a: unknown[]) => m.createRole(...a),
    postGenerateAvatarBatch: (...a: unknown[]) => m.postGenerateAvatarBatch(...a),
    postManualAvatarCandidate: (...a: unknown[]) => m.postManualAvatarCandidate(...a),
    roleAvatarUrl: (hostId: number, roleName: string) => `/roles/${roleName}/avatar?hostId=${hostId}`,
  };
}

export async function instanceWideApi(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    listInstanceWide: (...a: unknown[]) => m.listInstanceWide(...a),
    previewPromote: (...a: unknown[]) => m.previewPromote(...a),
    promote: (...a: unknown[]) => m.promote(...a),
    removeInstanceWide: (...a: unknown[]) => m.removeInstanceWide(...a),
  };
}

export function rolesArchiveListApi(): Record<string, unknown> {
  return { listArchivedRoles: (...a: unknown[]) => m.listArchivedRoles(...a) };
}

export async function roleUnarchiveApi(orig: Orig): Promise<Record<string, unknown>> {
  return { ...(await spread(orig)), unarchiveRole: (...a: unknown[]) => m.unarchiveRole(...a) };
}

export function roleArchiveApi(): Record<string, unknown> {
  return { archiveRole: (...a: unknown[]) => m.archiveRole(...a) };
}

export async function claudeSessionApi(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    getRoleFileByName: (...a: unknown[]) => m.getRoleFileByName(...a),
    updateRoleFileByName: (...a: unknown[]) => m.updateRoleFileByName(...a),
  };
}

export async function runbooksApi(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    listRunbooks: (...a: unknown[]) => m.listRunbooks(...a),
    enumerateRunbookFiles: (...a: unknown[]) => m.enumerateRunbookFiles(...a),
    readRunbookFile: (...a: unknown[]) => m.readRunbookFile(...a),
    writeRunbookFile: (...a: unknown[]) => m.writeRunbookFile(...a),
    writeRunbookFileBinary: (...a: unknown[]) => m.writeRunbookFileBinary(...a),
    createRunbookFile: (...a: unknown[]) => m.createRunbookFile(...a),
    deleteRunbookFile: (...a: unknown[]) => m.deleteRunbookFile(...a),
    deleteRunbook: (...a: unknown[]) => m.deleteRunbook(...a),
    createRunbook: (...a: unknown[]) => m.createRunbook(...a),
    renameRunbook: (...a: unknown[]) => m.renameRunbook(...a),
  };
}

export async function workspaceApi(orig: Orig): Promise<Record<string, unknown>> {
  return { ...(await spread(orig)), listWorkspace: (...a: unknown[]) => m.listWorkspace(...a) };
}

export async function workspaceGitApi(orig: Orig): Promise<Record<string, unknown>> {
  return { ...(await spread(orig)), hasGitRepos: (...a: unknown[]) => m.hasGitRepos(...a) };
}

export async function voiceApi(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    fetchVoiceCatalog: (...a: unknown[]) => m.fetchVoiceCatalog(...a),
    postSpeak: (...a: unknown[]) => m.postSpeak(...a),
  };
}

export async function identitiesStore(orig: Orig): Promise<Record<string, unknown>> {
  return {
    ...(await spread(orig)),
    useIdentities: () => ({
      identities: store.identities,
      byKey: new Map(),
      byHostKey: new Map(),
      loaded: true,
      refresh: async () => {},
    }),
  };
}

/** MDXEditor → a plain textarea (jsdom can't run the real editor). */
export function mdxEditor(): Record<string, unknown> {
  const none = (): null => null;
  const plugin = (): Record<string, never> => ({});
  return {
    MDXEditor: (props: { markdown: string; onChange?: (v: string) => void; readOnly?: boolean }) => (
      <textarea
        data-testid="mdxeditor"
        value={props.markdown}
        onChange={(e) => props.onChange?.(e.target.value)}
        readOnly={props.readOnly}
      />
    ),
    headingsPlugin: plugin,
    listsPlugin: plugin,
    quotePlugin: plugin,
    thematicBreakPlugin: plugin,
    markdownShortcutPlugin: plugin,
    linkPlugin: plugin,
    linkDialogPlugin: plugin,
    tablePlugin: plugin,
    codeBlockPlugin: plugin,
    codeMirrorPlugin: plugin,
    frontmatterPlugin: plugin,
    toolbarPlugin: plugin,
    UndoRedo: none,
    BoldItalicUnderlineToggles: none,
    BlockTypeSelect: none,
    CreateLink: none,
    InsertTable: none,
    ListsToggle: none,
    InsertFrontmatter: none,
  };
}
