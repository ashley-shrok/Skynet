/**
 * The agent window for an ARCHIVED agent: it reads the archived folder and is
 * view-only. (Original harness below is borrowed from the agent-window tests.)
 *
 * Borrowed notes — the agent window (IdentityModal) after the apple-ux redesign:
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
        req.type === "identity:list-archived-apps"
          ? {
              type: "identity:archived-apps",
              apps: [{ slug: "tracker", title: "Tracker", description: "Counts things", iconDataUrl: null }],
            }
          : req.type === "identity:get-identity-file"
          ? { type: "identity:identity-file", markdown: AGENT_FILE }
          : req.type === "identity:list-wakeups"
            ? {
                type: "identity:wakeups",
                wakeups: [
                  { slug: "daily", name: "Daily check", enabled: true, scheduleHuman: "Daily at 09:00", instruction: "x", lastFiredAt: null, schedule: { type: "daily", at: "09:00" } },
                ],
              }
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
vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: ({ content, onChange }: { content: string; onChange: (md: string) => void }) => (
    <textarea data-testid="md-editor" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

let gitAnswer: boolean | null = false;
vi.mock("@/features/pretty-view/use-has-git-repos", () => ({
  useHasGitRepos: () => gitAnswer === true,
  useGitReposAnswer: () => gitAnswer,
}));
vi.mock("@/features/pretty-view/use-desktop-running", () => ({ useDesktopRunning: () => false }));
vi.mock("@/features/pretty-view/DesktopTab", () => ({ default: () => <div data-testid="desktop-tab-stub" /> }));
const workspaceProps: Array<Record<string, unknown>> = [];
vi.mock("@/features/pretty-view/WorkspaceTab", () => ({
  default: (p: Record<string, unknown>) => {
    workspaceProps.push(p);
    return <div data-testid="workspace-tab-stub" />;
  },
}));

const COMMIT = { sha: "abcdef1234567890", parents: [], author: "Alice", timeMs: 0, refs: [], subject: "Fix the thing" };
vi.mock("@/features/pretty-view/AgentGit", () => ({
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

import { IdentityModal } from "@/features/pretty-view/IdentityModal";

// ── Fixture ──────────────────────────────────────────────────────────────────

const IDENTITY: Identity = {
  identityKey: "olden",
  displayName: "Olden",
  title: null,
  colorHue: 140,
  voice: "Matthew",
  role: null,
  roles: ["box-maintainer", "gardener"],
  task: "Fix the printer",
  project: null,
  avatarMime: "",
  avatarUrl: "",
  avatarEtag: "",
  coordinator: false,
};

function renderArchived() {
  const onOpenRoleModal = vi.fn();
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={IDENTITY}
      hue={140}
      hostId={7}
      onOpenRoleModal={onOpenRoleModal}
      archived={{ archivedRoles: ["gardener"] }}
    />,
  );
  return { onOpenRoleModal };
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  workspaceProps.length = 0;
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

describe("agent window — archived agent (view-only)", () => {
  it("reads the archived folder: agent file, wake-ups and apps are asked for as archived", async () => {
    renderArchived();
    expect(await screen.findByTestId("identity-modal-agent-file")).toBeTruthy();
    expect(sent.find((r) => r.type === "identity:get-identity-file")).toMatchObject({ archived: true, identityKey: "olden" });
    expect(sent.find((r) => r.type === "identity:list-wakeups")).toMatchObject({ archived: true });
    expect(sent.find((r) => r.type === "identity:list-archived-apps")).toMatchObject({ identityKey: "olden", hostId: 7 });
  });

  it("nothing can be changed: no Edit, no task pencil, voice disabled", async () => {
    renderArchived();
    await screen.findByTestId("identity-modal-agent-file");
    expect(screen.queryByTestId("identity-modal-edit")).toBeNull();
    expect(screen.queryByTestId("identity-modal-task-pencil")).toBeNull();
    expect(screen.getByTestId("identity-modal-task-value").textContent).toBe("Fix the printer");
    expect((screen.getByTestId("identity-modal-voice-chip") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a live role is a link; an archived role is plain text", async () => {
    const { onOpenRoleModal } = renderArchived();
    await screen.findByTestId("identity-modal-hero");
    expect(screen.getAllByTestId("identity-modal-title-line-jump")).toHaveLength(1);
    expect(screen.getByTestId("identity-modal-role-archived").textContent).toBe("Gardener");
    fireEvent.click(screen.getByTestId("identity-modal-title-line-jump"));
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledWith(IDENTITY, "box-maintainer"));
  });

  it("wake-ups are listed with no switch and nothing to add", async () => {
    renderArchived();
    fireEvent.click(await screen.findByTestId("identity-modal-nav-identity-wakeups"));
    expect(await screen.findByTestId("wakeup-row-daily")).toBeTruthy();
    expect(screen.queryByTestId("wakeup-switch-daily")).toBeNull();
    expect(screen.queryByText("New wake-up")).toBeNull();
    expect(screen.getByText(/none of these fire/)).toBeTruthy();
  });

  it("Files reads the archived workspace view-only", async () => {
    renderArchived();
    fireEvent.click(await screen.findByTestId("identity-modal-nav-workspace"));
    await screen.findByTestId("workspace-tab-stub");
    expect(workspaceProps.at(-1)).toMatchObject({
      target: { kind: "archived-identity", identityKey: "olden" },
      readOnly: true,
    });
  });

  it("Apps lists the archived apps, which don't open", async () => {
    renderArchived();
    fireEvent.click(await screen.findByTestId("identity-modal-nav-apps"));
    const row = await screen.findByTestId("identity-apps-row");
    expect(row.textContent).toContain("Tracker");
    expect(row.tagName).not.toBe("BUTTON");
    expect(screen.getByText(/apps aren't running/)).toBeTruthy();
  });
});
