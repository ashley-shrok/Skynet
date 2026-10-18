/**
 * The agent window (IdentityModal) after the apple-ux redesign:
 *
 *   - the project line under the task ("In Morpheus 2 › M2 · Runs"), from
 *     the projects store + identity.project; absent when there is none
 *   - the agent file's Edit / Cancel / Save foot, and the "Discard your
 *     changes?" question on every way out of unsaved edits (Cancel, another
 *     tab, closing, Esc, a role link)
 *   - the stack of deeper views: the back control names the level above
 *     (the agent at depth 1), Esc goes up exactly one level
 *   - no Close button in the foot (the head's × closes)
 *
 * The git bodies are stubbed (AgentGit has its own tests): each stub just
 * offers the opener that pushes the next level.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { ProjectRow } from "@/state/conversation-store";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

// ── WS stub: answers the agent-file and wake-ups one-shots ───────────────────

const AGENT_FILE = "---\nrole: box-maintainer\n---\n\n# Tabitha\n\nKeeps the box healthy.\n";

type WsStub = {
  readyState: number;
  send: (payload: string) => void;
  close: () => void;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: () => void;
  removeEventListener: () => void;
};

const sent: Array<{ type: string } & Record<string, unknown>> = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
    readyState: 1,
    send: (payload: string) => {
      const req = JSON.parse(payload) as { type: string; contents?: string };
      sent.push(req);
      const reply =
        req.type === "identity:get-identity-file"
          ? { type: "identity:identity-file", markdown: AGENT_FILE }
          : req.type === "identity:list-wakeups"
            ? { type: "identity:wakeups", wakeups: [] }
            : req.type === "identity:update-identity-file"
              ? { type: "identity:identity-file-updated", markdown: req.contents }
              : null;
      if (reply) queueMicrotask(() => ws.onmessage?.({ data: JSON.stringify(reply) } as MessageEvent<string>));
    },
    close: () => {},
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, openClaudeSessionSocket: () => makeFakeWs() };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, updateIdentity: vi.fn(), listIdentities: vi.fn().mockResolvedValue([]) };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    refreshIdentities: vi.fn().mockResolvedValue(undefined),
  };
});

let projects: ProjectRow[] = [];
vi.mock("@/state/conversation-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, useProjects: () => projects };
});

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1" }),
  handleApiError: vi.fn(),
}));

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
  fetchVoiceCatalog: vi.fn(async () => ({
    voices: [{ id: "Matthew", name: "Matthew" }],
    defaultVoice: "Matthew",
    listError: false,
  })),
}));

// The rich editor → a plain textarea. Typing marks the file as touched (the
// window's capture handlers), then the change becomes the draft.
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ content, onChange }: { content: string; onChange: (md: string) => void }) => (
    <textarea data-testid="md-editor" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

let gitAnswer: boolean | null = false;
vi.mock("./use-has-git-repos", () => ({
  useHasGitRepos: () => gitAnswer === true,
  useGitReposAnswer: () => gitAnswer,
}));
vi.mock("./use-desktop-running", () => ({ useDesktopRunning: () => false }));
vi.mock("./DesktopTab", () => ({ default: () => <div data-testid="desktop-tab-stub" /> }));
vi.mock("./WorkspaceTab", () => ({ default: () => <div data-testid="workspace-tab-stub" /> }));

const COMMIT = { sha: "abcdef1234567890", parents: [], author: "Alice", timeMs: 0, refs: [], subject: "Fix the thing" };
vi.mock("./AgentGit", () => ({
  useAgentGit: () => ({ target: null, hostId: 7, remote: {}, checkRemotes: () => {}, refreshKey: 0, refresh: () => {} }),
  AgentGitRoot: ({ onOpenRepo }: { onOpenRepo: (p: string) => void }) => (
    <button data-testid="git-root-stub" onClick={() => onOpenRepo("app")}>
      open repo
    </button>
  ),
  AgentGitRepo: ({ onOpenCommit }: { onOpenCommit: (p: string, c: typeof COMMIT) => void }) => (
    <button data-testid="git-repo-stub" onClick={() => onOpenCommit("app", COMMIT)}>
      open commit
    </button>
  ),
  AgentGitCommit: () => <div data-testid="git-commit-stub" />,
  AgentGitDiff: () => <div data-testid="git-diff-stub" />,
}));

import { IdentityModal } from "./IdentityModal";

// ── Fixture ──────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tabitha",
  displayName: "Tabitha",
  title: null,
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  task: null,
  project: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tabitha/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

function project(slug: string, displayName: string, parent: string | null = null, hostId = "7"): ProjectRow {
  return { slug, displayName, hostId, hostname: "box", archived: false, parent };
}

function renderModal(overrides?: Partial<Identity>, props?: { gitReposHint?: boolean }) {
  const onOpenChange = vi.fn();
  const onOpenRoleModal = vi.fn();
  render(
    <IdentityModal
      open={true}
      onOpenChange={onOpenChange}
      identity={{ ...BASE_IDENTITY, ...overrides }}
      hue={220}
      hostId={7}
      onOpenRoleModal={onOpenRoleModal}
      {...props}
    />,
  );
  return { onOpenChange, onOpenRoleModal };
}

/** Open the agent file editor and type into it so it holds unsaved edits. */
async function makeFileDirty(): Promise<void> {
  fireEvent.click(await screen.findByTestId("identity-modal-edit"));
  const editor = await screen.findByTestId("md-editor");
  fireEvent.keyDown(editor, { key: "x" });
  fireEvent.change(editor, { target: { value: AGENT_FILE + "\nMore.\n" } });
  await waitFor(() => expect((screen.getByTestId("identity-modal-save") as HTMLButtonElement).disabled).toBe(false));
}

const backLabel = () => screen.getByTestId("identity-modal-back").textContent?.trim();

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  projects = [];
  gitAnswer = false;
  __resetKitDialogsForTests();
});
afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
});
afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("agent window — project line", () => {
  it("top-level project: reads \"In <project>\"", async () => {
    projects = [project("m2", "Morpheus 2")];
    renderModal({ project: "m2" });
    expect((await screen.findByTestId("identity-modal-project-line")).textContent).toBe("In Morpheus 2");
  });

  it("sub-project: the whole lineage, top level first", async () => {
    projects = [project("m2-runs", "M2 · Runs", "m2"), project("m2", "Morpheus 2"), project("other", "Other")];
    renderModal({ project: "m2-runs" });
    expect((await screen.findByTestId("identity-modal-project-line")).textContent).toBe("In Morpheus 2 › M2 · Runs");
  });

  it("no project → no project line", async () => {
    projects = [project("m2", "Morpheus 2")];
    renderModal({ project: null });
    await screen.findByTestId("identity-modal-hero");
    expect(screen.queryByTestId("identity-modal-project-line")).toBeNull();
  });

  it("a project the store doesn't know (or on another host) → no project line", async () => {
    projects = [project("m2", "Morpheus 2", null, "9")];
    renderModal({ project: "m2" });
    await screen.findByTestId("identity-modal-hero");
    expect(screen.queryByTestId("identity-modal-project-line")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("agent window — agent file editing", () => {
  it("renders the file in the window with Edit in the foot — and no Close button there", async () => {
    renderModal();
    expect((await screen.findByTestId("identity-modal-agent-file")).textContent).toContain("Keeps the box healthy.");
    const foot = document.querySelector('[data-slot="modal-foot"]') as HTMLElement;
    expect(foot).toBeTruthy();
    const footButtons = within(foot).getAllByRole("button");
    expect(footButtons.map((b) => b.textContent?.trim())).toEqual(["Edit"]);
    expect(within(foot).queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("Edit → Cancel with no changes leaves without asking", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderModal();
    fireEvent.click(await screen.findByTestId("identity-modal-edit"));
    await screen.findByTestId("md-editor");
    // Save stays disabled until something actually changes.
    expect((screen.getByTestId("identity-modal-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("identity-modal-cancel-edit"));
    await waitFor(() => expect(screen.queryByTestId("md-editor")).toBeNull());
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Edit → dirty → Cancel asks; \"Keep editing\" keeps the editor and the edits", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-cancel-edit"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    const opts = dialogs.calls[0].opts as { title: string; cancelLabel?: string; confirmLabel?: string };
    expect(opts.title).toBe("Discard your changes?");
    expect(opts.cancelLabel).toBe("Keep editing");
    expect(opts.confirmLabel).toBe("Discard");
    expect((screen.getByTestId("md-editor") as HTMLTextAreaElement).value).toContain("More.");
    expect(screen.queryByTestId("identity-modal-edit")).toBeNull();
  });

  it("a task or voice change while editing keeps the editor and the unsaved edits", async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      hue: 220,
      hostId: 7,
      onOpenRoleModal: vi.fn(),
    };
    const { rerender } = render(<IdentityModal {...props} identity={BASE_IDENTITY} />);
    await makeFileDirty();
    rerender(<IdentityModal {...props} identity={{ ...BASE_IDENTITY, task: "Something new", voice: "v2" }} />);
    expect((screen.getByTestId("md-editor") as HTMLTextAreaElement).value).toContain("More.");
    expect(screen.getByTestId("identity-modal-save")).toBeTruthy();
  });

  it("Edit → dirty → Cancel → Discard leaves the editor, back to the rendered file", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-cancel-edit"));
    await screen.findByTestId("identity-modal-agent-file");
    expect(screen.queryByTestId("md-editor")).toBeNull();
    expect(dialogs.calls).toHaveLength(1);
    expect(sent.some((r) => r.type === "identity:update-identity-file")).toBe(false);
  });

  it("Save sends the draft and returns to the rendered file", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-save"));
    expect((await screen.findByTestId("identity-modal-agent-file")).textContent).toContain("More.");
    const save = sent.find((r) => r.type === "identity:update-identity-file");
    expect(save?.contents).toBe(AGENT_FILE + "\nMore.\n");
    expect(dialogs.calls).toHaveLength(0);
  });

  it("switching tab with unsaved edits asks; keeping edits stays on the agent file", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-nav-identity-wakeups"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(screen.getByTestId("identity-modal-nav-identity").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("md-editor")).toBeTruthy();
  });

  it("switching tab with unsaved edits → Discard switches", async () => {
    autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-nav-identity-wakeups"));
    await waitFor(() =>
      expect(screen.getByTestId("identity-modal-nav-identity-wakeups").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("closing with unsaved edits asks; keeping edits keeps the window open", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { onOpenChange } = renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-close"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Esc with unsaved edits asks instead of closing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { onOpenChange } = renderModal();
    await makeFileDirty();
    fireEvent.keyDown(screen.getByTestId("md-editor"), { key: "Escape" });
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(screen.getByTestId("md-editor")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("a role link with unsaved edits asks first; keeping edits opens nothing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { onOpenChange, onOpenRoleModal } = renderModal();
    await makeFileDirty();
    fireEvent.click(screen.getByTestId("identity-modal-title-line-jump"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(onOpenRoleModal).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("agent window — deeper views", () => {
  async function openGitTab() {
    gitAnswer = true;
    const spies = renderModal();
    fireEvent.click(await screen.findByTestId("identity-modal-nav-git"));
    return spies;
  }

  it("depth 1: the back control is labelled with the agent's name; back returns to the top", async () => {
    await openGitTab();
    fireEvent.click(await screen.findByTestId("git-root-stub"));
    await screen.findByTestId("git-repo-stub");
    expect(backLabel()).toBe("Tabitha");
    // The deeper view replaces the agent's top (no hero, no tabs).
    expect(screen.queryByTestId("identity-modal-hero")).toBeNull();
    expect(screen.queryByTestId("identity-modal-nav")).toBeNull();
    fireEvent.click(screen.getByTestId("identity-modal-back"));
    await screen.findByTestId("git-root-stub");
    expect(screen.queryByTestId("identity-modal-back")).toBeNull();
    expect(screen.getByTestId("identity-modal-hero")).toBeTruthy();
  });

  it("depth 2: the back control names the level above", async () => {
    await openGitTab();
    fireEvent.click(await screen.findByTestId("git-root-stub"));
    fireEvent.click(await screen.findByTestId("git-repo-stub"));
    await screen.findByTestId("git-commit-stub");
    expect(backLabel()).toBe("app");
  });

  it("Esc from a deeper view goes up exactly one level (and never closes the window)", async () => {
    const { onOpenChange } = await openGitTab();
    fireEvent.click(await screen.findByTestId("git-root-stub"));
    fireEvent.click(await screen.findByTestId("git-repo-stub"));
    await screen.findByTestId("git-commit-stub");

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await screen.findByTestId("git-repo-stub");
    expect(backLabel()).toBe("Tabitha");

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await screen.findByTestId("git-root-stub");
    expect(screen.queryByTestId("identity-modal-back")).toBeNull();
    expect(screen.getByTestId("identity-modal-nav-git").getAttribute("aria-pressed")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Esc at the top (nothing unsaved) closes the window", async () => {
    const { onOpenChange } = renderModal();
    await screen.findByTestId("identity-modal-agent-file");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
