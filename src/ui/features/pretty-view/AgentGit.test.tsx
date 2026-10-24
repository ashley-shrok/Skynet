/**
 * The agent window's git views (AgentGit.tsx): the tab root (one repo shown
 * straight away, a list when there are several), a commit's file list, and
 * a working-tree diff narrowed to one file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { checkGitRemote, getGitDiff, getGitRepo, listGitRepos, type GitCommit } from "@/api/workspace-git-api";
import { AgentGitCommit, AgentGitDiff, AgentGitRoot, useAgentGit, type GitDiffSource, type GitOpeners } from "./AgentGit";

vi.mock("@/api/workspace-git-api", () => ({
  listGitRepos: vi.fn(),
  getGitRepo: vi.fn(),
  getGitDiff: vi.fn(),
  hasGitRepos: vi.fn(),
  checkGitRemote: vi.fn(),
}));

// The real diff viewer is heavy; show the patch it is handed as text.
vi.mock("./file-viewers/diff/DiffView", () => ({
  DiffView: ({ content }: { content: string }) => <pre data-testid="diff-view">{content}</pre>,
}));

const target = { kind: "identity" as const, identityKey: "alice" };

const commit: GitCommit = {
  sha: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
  parents: [],
  author: "Alice",
  timeMs: Date.now() - 3_600_000,
  refs: ["HEAD -> main"],
  subject: "Add login form",
};

function repoSummary(path: string) {
  return {
    path,
    error: null,
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 1,
    untracked: 0,
    conflicted: 0,
    lastCommit: commit,
  };
}

const PATCH_A = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n-old a\n+new a\n+more a\n";
const PATCH_B = "diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n@@ -1,3 +1 @@\n-one\n-two\n-three\n+only b\n";
const TWO_FILE_PATCH = PATCH_A + PATCH_B;

function openers() {
  return {
    onOpenRepo: vi.fn<GitOpeners["onOpenRepo"]>(),
    onOpenCommit: vi.fn<GitOpeners["onOpenCommit"]>(),
    onOpenDiff: vi.fn<GitOpeners["onOpenDiff"]>(),
  };
}

function Root(props: GitOpeners) {
  const git = useAgentGit(target, 7);
  return <AgentGitRoot git={git} {...props} />;
}
function Commit({ onOpenDiff }: { onOpenDiff: GitOpeners["onOpenDiff"] }) {
  const git = useAgentGit(target, 7);
  return <AgentGitCommit git={git} repoPath="app" commit={commit} onOpenDiff={onOpenDiff} />;
}
function Diff({ source }: { source: GitDiffSource }) {
  const git = useAgentGit(target, 7);
  return <AgentGitDiff git={git} source={source} />;
}

beforeEach(() => {
  vi.mocked(listGitRepos).mockReset();
  vi.mocked(getGitDiff).mockReset();
  vi.mocked(checkGitRemote).mockReset();
  vi.mocked(getGitRepo).mockReset().mockResolvedValue({
    path: "app",
    status: {
      branch: "main",
      detached: false,
      oid: commit.sha,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      files: [{ path: "src/a.ts", origPath: null, index: ".", worktree: "M", kind: "changed" }],
    },
    commits: [commit],
    stashes: [],
    remotes: [{ name: "origin", url: "https://github.com/o/app.git" }],
  });
});

describe("AgentGitRoot", () => {
  it("one repo: shows that repo straight away (no list to pick from)", async () => {
    vi.mocked(listGitRepos).mockResolvedValue({ truncated: false, repos: [repoSummary("app")] });
    const o = openers();
    render(<Root {...o} />);
    const repo = await screen.findByTestId("agent-git-repo");
    expect(getGitRepo).toHaveBeenCalledWith(target, 7, "app");
    expect(screen.queryByTestId("agent-git-repos")).toBeNull();
    // Its sections are right there: changes, history, remotes.
    expect(within(repo).getAllByTestId("git-file-row")[0].textContent).toContain("src/a.ts");
    expect(within(repo).getAllByTestId("git-commit-row")[0].textContent).toContain("Add login form");
    expect(repo.textContent).toContain("Remotes");
    expect(o.onOpenRepo).not.toHaveBeenCalled();
  });

  it("one repo: a commit row opens the commit, a changed file opens its working diff", async () => {
    vi.mocked(listGitRepos).mockResolvedValue({ truncated: false, repos: [repoSummary("app")] });
    const o = openers();
    render(<Root {...o} />);
    fireEvent.click(await screen.findByTestId("git-commit-row"));
    expect(o.onOpenCommit).toHaveBeenCalledWith("app", commit);
    fireEvent.click(screen.getByTestId("git-file-row"));
    expect(o.onOpenDiff).toHaveBeenCalledWith(
      { source: "working", repoPath: "app", path: "src/a.ts" },
      "src/a.ts",
      "Uncommitted change",
    );
  });

  it("two repos: shows a list; picking one fires onOpenRepo with its path", async () => {
    vi.mocked(listGitRepos).mockResolvedValue({ truncated: false, repos: [repoSummary("app"), repoSummary("lib")] });
    const o = openers();
    render(<Root {...o} />);
    await screen.findByTestId("agent-git-repos");
    const rows = screen.getAllByTestId("git-repo-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("app");
    expect(rows[1].textContent).toContain("lib");
    expect(getGitRepo).not.toHaveBeenCalled();
    fireEvent.click(rows[1]);
    expect(o.onOpenRepo).toHaveBeenCalledWith("lib");
  });

  it("no repos: says so", async () => {
    vi.mocked(listGitRepos).mockResolvedValue({ truncated: false, repos: [] });
    render(<Root {...openers()} />);
    expect(await screen.findByText("No git repos here yet.")).toBeTruthy();
  });
});

describe("AgentGitCommit", () => {
  it("lists the commit's files from its patch, with +/− counts", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    render(<Commit onOpenDiff={vi.fn()} />);
    const rows = await screen.findAllByTestId("git-commit-file-row");
    expect(getGitDiff).toHaveBeenCalledWith(target, 7, "app", { diff: "commit", sha: commit.sha });
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("src/a.ts");
    expect(rows[0].textContent).toContain("+2");
    expect(rows[0].textContent).toContain("−1");
    expect(rows[1].textContent).toContain("notes.md");
    expect(rows[1].textContent).toContain("+1");
    expect(rows[1].textContent).toContain("−3");
    expect(screen.getByTestId("agent-git-commit").textContent).toContain("2 files");
  });

  it("clicking a file opens a diff of just that file's patch", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    const onOpenDiff = vi.fn();
    render(<Commit onOpenDiff={onOpenDiff} />);
    const rows = await screen.findAllByTestId("git-commit-file-row");
    fireEvent.click(rows[1]);
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    const [source, title, subtitle] = onOpenDiff.mock.calls[0];
    expect(source).toEqual({ source: "patch", patch: PATCH_B, truncated: false });
    expect(title).toBe("notes.md");
    expect(subtitle).toBe("a1b2c3d · Add login form");
  });

  it("View all opens the whole commit's patch", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    const onOpenDiff = vi.fn();
    render(<Commit onOpenDiff={onOpenDiff} />);
    fireEvent.click(await screen.findByTestId("agent-git-commit-all"));
    expect(onOpenDiff.mock.calls[0][0]).toEqual({ source: "patch", patch: TWO_FILE_PATCH, truncated: false });
  });
});

describe("AgentGitDiff", () => {
  it("a new folder's row (\"dir/\") shows every file inside it", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    render(<Diff source={{ source: "working", repoPath: "app", path: "src/" }} />);
    const view = await screen.findByTestId("diff-view");
    expect(view.textContent).toContain("new a");
    expect(view.textContent).not.toContain("only b");
  });

  it("working diff for one path shows only that file", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    render(<Diff source={{ source: "working", repoPath: "app", path: "notes.md" }} />);
    const view = await screen.findByTestId("diff-view");
    expect(getGitDiff).toHaveBeenCalledWith(target, 7, "app", { diff: "working" });
    expect(view.textContent).toContain("only b");
    expect(view.textContent).not.toContain("src/a.ts");
    expect(view.textContent).not.toContain("new a");
  });

  it("working diff for every path (path null) shows the whole patch", async () => {
    vi.mocked(getGitDiff).mockResolvedValue({ truncated: false, patch: TWO_FILE_PATCH });
    render(<Diff source={{ source: "working", repoPath: "app", path: null }} />);
    const view = await screen.findByTestId("diff-view");
    expect(view.textContent).toContain("new a");
    expect(view.textContent).toContain("only b");
  });

  it("a patch already in hand renders without fetching", async () => {
    render(<Diff source={{ source: "patch", patch: PATCH_A }} />);
    expect((await screen.findByTestId("diff-view")).textContent).toContain("new a");
    await waitFor(() => expect(getGitDiff).not.toHaveBeenCalled());
  });
});
