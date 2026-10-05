import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react";
import GitTab from "./GitTab";
import { useHasGitRepos } from "./use-has-git-repos";
import {
  checkGitRemote,
  getGitDiff,
  getGitRepo,
  hasGitRepos,
  listGitRepos,
} from "@/api/workspace-git-api";

vi.mock("@/api/workspace-git-api", () => ({
  listGitRepos: vi.fn(),
  getGitRepo: vi.fn(),
  getGitDiff: vi.fn(),
  hasGitRepos: vi.fn(),
  checkGitRemote: vi.fn(),
}));

const target = { kind: "identity" as const, identityKey: "alice" };
const commit = {
  sha: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
  parents: [],
  author: "Alice",
  timeMs: Date.now() - 3_600_000,
  refs: ["HEAD -> main", "origin/main"],
  subject: "Add login form",
};

beforeEach(() => {
  vi.mocked(listGitRepos).mockResolvedValue({
    truncated: false,
    repos: [
      {
        path: "app",
        error: null,
        branch: "main",
        detached: false,
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        staged: 1,
        unstaged: 3,
        untracked: 0,
        conflicted: 0,
        lastCommit: commit,
      },
    ],
  });
  vi.mocked(getGitRepo).mockResolvedValue({
    path: "app",
    status: {
      branch: "main",
      detached: false,
      oid: commit.sha,
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      files: [
        { path: "src/a.ts", origPath: null, index: ".", worktree: "M", kind: "changed" },
        { path: "notes.md", origPath: null, index: ".", worktree: "?", kind: "untracked" },
      ],
    },
    commits: [commit],
    stashes: [],
    remotes: [{ name: "origin", url: "https://github.com/o/app.git" }],
  });
  vi.mocked(getGitDiff).mockResolvedValue({
    truncated: false,
    patch: "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n",
  });
});

describe("GitTab", () => {
  it("lists repos with branch, sync and change summary", async () => {
    render(<GitTab target={target} hostId={7} hue={200} />);
    const row = await screen.findByTestId("git-repo-row");
    expect(row.textContent).toContain("app");
    expect(row.textContent).toContain("main");
    expect(row.textContent).toContain("1 staged");
    expect(row.textContent).toContain("3 modified");
    expect(row.textContent).toContain("Add login form");
    expect(listGitRepos).toHaveBeenCalledWith(target, 7);
    expect(screen.queryByText(/project/i)).toBeNull();
  });

  it("Check remotes replaces last-fetch counts with live ones", async () => {
    vi.mocked(checkGitRemote).mockResolvedValue({
      ahead: 2,
      behind: 5,
      upstream: "origin/main",
      checkedAtMs: Date.now(),
    });
    render(<GitTab target={target} hostId={7} hue={200} />);
    const row = await screen.findByTestId("git-repo-row");
    expect(row.textContent).not.toContain("5");
    fireEvent.click(screen.getByText("Check remotes"));
    await waitFor(() => expect(row.textContent).toContain("live"));
    expect(row.textContent).toContain("5");
    expect(checkGitRemote).toHaveBeenCalledWith(target, 7, "app");
  });

  it("shows a friendly pill when the remote can't be reached", async () => {
    vi.mocked(checkGitRemote).mockRejectedValue(new Error("fetch_failed"));
    render(<GitTab target={target} hostId={7} hue={200} />);
    const row = await screen.findByTestId("git-repo-row");
    fireEvent.click(screen.getByText("Check remotes"));
    await waitFor(() => expect(row.textContent).toContain("Couldn't reach the remote"));
  });

  it("drills into a repo, then a commit diff, and back", async () => {
    render(<GitTab target={target} hostId={7} hue={200} />);
    fireEvent.click(await screen.findByTestId("git-repo-row"));

    expect(await screen.findAllByTestId("git-file-row")).toHaveLength(2);
    expect(getGitRepo).toHaveBeenCalledWith(target, 7, "app");
    expect(screen.getByText("https://github.com/o/app.git")).toBeTruthy();

    fireEvent.click(screen.getByTestId("git-commit-row"));
    await waitFor(() =>
      expect(getGitDiff).toHaveBeenCalledWith(target, 7, "app", { diff: "commit", sha: commit.sha }),
    );
    expect(await screen.findByText("new")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Back"));
    expect(await screen.findAllByTestId("git-file-row")).toHaveLength(2);
  });

  it("opens the working-tree diff from View changes", async () => {
    render(<GitTab target={target} hostId={7} hue={200} />);
    fireEvent.click(await screen.findByTestId("git-repo-row"));
    fireEvent.click(await screen.findByText("View changes"));
    await waitFor(() =>
      expect(getGitDiff).toHaveBeenCalledWith(target, 7, "app", { diff: "working" }),
    );
  });

  it("shows friendly copy for backend error classes", async () => {
    vi.mocked(listGitRepos).mockRejectedValue(new Error("git_missing"));
    render(<GitTab target={target} hostId={7} hue={200} />);
    expect(await screen.findByText("Git isn't installed")).toBeTruthy();
  });
});

describe("useHasGitRepos", () => {
  it("is false until the probe says there are repos", async () => {
    vi.mocked(hasGitRepos).mockResolvedValue(true);
    const { result } = renderHook(() => useHasGitRepos(target, 7, true));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false when there are none or the probe fails, and doesn't probe while closed", async () => {
    vi.mocked(hasGitRepos).mockClear();
    renderHook(() => useHasGitRepos(target, 7, false));
    expect(hasGitRepos).not.toHaveBeenCalled();

    vi.mocked(hasGitRepos).mockRejectedValue(new Error("host_unreachable"));
    const { result } = renderHook(() => useHasGitRepos(target, 7, true));
    await waitFor(() => expect(hasGitRepos).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
