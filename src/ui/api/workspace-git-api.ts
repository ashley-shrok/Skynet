/**
 * Client-side surface to the read-only /workspace/git router
 * (src/backend/database/routes/workspace-git-routes.ts). One helper per route.
 *
 * Errors follow workspace-api.ts: when the response carries a backend error
 * class ("not_found", "git_missing", …) the helper throws an Error whose
 * .message IS that class; anything else goes through handleApiError.
 *
 * NO React, NO UI, NO stateful side effects in this file.
 */

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";
import type { WorkspaceTarget } from "@/api/workspace-api";

// ---------------------------------------------------------------------------
// Wire types (mirror workspace-git-parse.ts)
// ---------------------------------------------------------------------------

export type GitFileChange = {
  path: string;
  origPath: string | null;
  /** Staged state letter; "." means unchanged. */
  index: string;
  /** Unstaged state letter; "." means unchanged. */
  worktree: string;
  kind: "changed" | "renamed" | "conflicted" | "untracked";
};

type GitStatus = {
  branch: string | null;
  detached: boolean;
  oid: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  files: GitFileChange[];
};

export type GitCommit = {
  sha: string;
  parents: string[];
  author: string;
  timeMs: number;
  refs: string[];
  subject: string;
};

export type GitRepoSummary = {
  /** Relative to the workspace root; "" for the root itself. */
  path: string;
  error: "git_error" | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  lastCommit: GitCommit | null;
};

export type GitRepoDetail = {
  path: string;
  status: GitStatus;
  commits: GitCommit[];
  stashes: { ref: string; timeMs: number; message: string }[];
  remotes: { name: string; url: string }[];
};

export type GitReposResponse = { repos: GitRepoSummary[]; truncated: boolean };
export type GitDiffResponse = { patch: string; truncated: boolean };

/** Working tree vs last commit, or one commit vs its parent. */
export type GitDiffSpec = { diff: "working" } | { diff: "commit"; sha: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function targetToWireFields(t: WorkspaceTarget): Record<string, string> {
  if (t.kind === "role") return { kind: "role", roleSlug: t.roleSlug };
  return { identityKey: t.identityKey };
}

async function postGit<T>(route: string, body: Record<string, unknown>, label: string): Promise<T> {
  try {
    const response = await authApi.post(`/workspace/git${route}`, body);
    return response.data as T;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, label);
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Every git repo under the workspace, with a status summary each. */
export function listGitRepos(target: WorkspaceTarget, hostId: number): Promise<GitReposResponse> {
  return postGit("/repos", { ...targetToWireFields(target), hostId }, "list git repos");
}

/** Full status, recent commits, stashes and remotes for one repo. */
export function getGitRepo(
  target: WorkspaceTarget,
  hostId: number,
  repoPath: string,
): Promise<GitRepoDetail> {
  return postGit("/repo", { ...targetToWireFields(target), hostId, repoPath }, "read git repo");
}

/** Unified patch text for the working tree or one commit. */
export function getGitDiff(
  target: WorkspaceTarget,
  hostId: number,
  repoPath: string,
  spec: GitDiffSpec,
): Promise<GitDiffResponse> {
  return postGit(
    "/diff",
    { ...targetToWireFields(target), hostId, repoPath, ...spec },
    "read git diff",
  );
}

/** Cheap probe: does the workspace hold any git repo at all? */
export async function hasGitRepos(target: WorkspaceTarget, hostId: number): Promise<boolean> {
  const res = await postGit<{ hasRepos: boolean }>(
    "/has-repos",
    { ...targetToWireFields(target), hostId },
    "probe git repos",
  );
  return res.hasRepos;
}

export type GitRemoteCheck = {
  ahead: number;
  behind: number;
  upstream: string;
  checkedAtMs: number;
};

/**
 * Ask the remote for a fresh ahead/behind count. Downloads the upstream
 * branch into a private ref and deletes it again — the agent's branches and
 * remote-tracking refs are left untouched.
 */
export function checkGitRemote(
  target: WorkspaceTarget,
  hostId: number,
  repoPath: string,
): Promise<GitRemoteCheck> {
  return postGit(
    "/remote-check",
    { ...targetToWireFields(target), hostId, repoPath },
    "check git remote",
  );
}
