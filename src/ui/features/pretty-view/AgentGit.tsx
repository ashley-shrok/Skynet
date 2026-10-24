// The agent window's git views. The Git tab shows the workspace's one repo
// straight away (or a list of repos when there are several); a repo, a
// commit and a diff each open one level deeper in the window, which owns
// the header and the back control — these components are the bodies.
//
// Read-only, like the roles window's Git tab (GitTab.tsx), whose loading,
// remote-check and pill pieces this reuses.

import { useCallback, useMemo, useState } from "react";
import { FolderGit2, GitBranch, RefreshCw } from "lucide-react";
import {
  KitBanner,
  KitButton,
  KitChip,
  KitEmpty,
  KitIconButton,
  KitLoading,
  KitSegmented,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";
import {
  getGitDiff,
  getGitRepo,
  listGitRepos,
  type GitCommit,
  type GitRepoDetail,
  type WorkspaceTarget,
} from "@/api/workspace-git-api";
import { DiffView } from "./file-viewers/diff/DiffView";
import {
  canCheckRemote,
  ChangeSummary,
  CheckRemoteButton,
  describeChange,
  ErrorBanner,
  repoLabel,
  SyncPills,
  targetDepKey,
  timeAgo,
  TONE_TEXT,
  useLoad,
  useRemoteChecks,
  type RemoteChecks,
} from "./GitTab";
import { splitPatch, type PatchFile } from "./git-patch";

/** What a diff view shows: one file of the working tree, or a patch already in hand. */
export type GitDiffSource =
  | { source: "working"; repoPath: string; path: string | null }
  | { source: "patch"; patch: string; truncated?: boolean };

/** Shared state for every git view of one agent: remote checks + refresh. */
export interface AgentGitState {
  target: WorkspaceTarget;
  hostId: number;
  remote: RemoteChecks;
  checkRemotes: (paths: string[]) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useAgentGit(target: WorkspaceTarget, hostId: number): AgentGitState {
  const { remote, checkRemotes, reset } = useRemoteChecks(target, hostId);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => {
    reset();
    setRefreshKey((k) => k + 1);
  }, [reset]);
  return { target, hostId, remote, checkRemotes, refreshKey, refresh };
}

export interface GitOpeners {
  onOpenRepo: (repoPath: string) => void;
  onOpenCommit: (repoPath: string, commit: GitCommit) => void;
  onOpenDiff: (source: GitDiffSource, title: string, subtitle: string) => void;
}

const PAD = "px-6 max-sm:px-5";

// ---------------------------------------------------------------------------
// Tab root: the one repo, or the list of repos
// ---------------------------------------------------------------------------

export function AgentGitRoot({ git, ...open }: { git: AgentGitState } & GitOpeners): JSX.Element {
  const state = useLoad(() => listGitRepos(git.target, git.hostId), [targetDepKey(git.target), git.hostId, git.refreshKey]);
  if (state.status === "loading") return <div className={`${PAD} py-4`}><KitLoading label="Looking for repos…" /></div>;
  if (state.status === "error") return <ErrorBanner errorClass={state.errorClass} />;
  const { repos, truncated } = state.data;
  if (repos.length === 0) {
    return <KitEmpty icon={<FolderGit2 aria-hidden="true" />} title="No git repos here yet." />;
  }
  if (repos.length === 1 && !truncated) {
    return <AgentGitRepo git={git} repoPath={repos[0].path} {...open} />;
  }
  const checkable = repos.filter((r) => !r.error && canCheckRemote(r)).map((r) => r.path);
  const busy = Object.values(git.remote).some((r) => r.status === "checking");
  return (
    <div className={`${PAD} py-4 flex flex-col gap-1`} data-testid="agent-git-repos">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex-1 text-[12.5px] text-[var(--k-t3)]">
          Git repos in this agent&apos;s workspace. Read-only — the agent makes the commits.
        </span>
        <CheckRemoteButton label="Check remotes" busy={busy} disabled={checkable.length === 0} onClick={() => git.checkRemotes(checkable)} />
        <KitIconButton label="Refresh" size="sm" onClick={git.refresh}>
          <RefreshCw />
        </KitIconButton>
      </div>
      <KitSettingsGroup>
        {repos.map((repo) => (
          <KitSettingsRow
            key={repo.path}
            data-testid="git-repo-row"
            leading={<RepoTile />}
            label={<span className="font-semibold">{repoLabel(repo.path)}</span>}
            description={
              <span className="flex flex-col gap-1.5 pt-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  {repo.branch && (
                    <KitChip>
                      <GitBranch size={11} aria-hidden="true" />
                      {repo.branch}
                    </KitChip>
                  )}
                  {repo.error ? (
                    <KitChip tone="danger">Unreadable</KitChip>
                  ) : (
                    <>
                      <SyncPills {...repo} remote={git.remote[repo.path]} />
                      <ChangeSummary repo={repo} />
                    </>
                  )}
                </span>
                <span className="block truncate">
                  {repo.lastCommit
                    ? `${repo.lastCommit.subject} · ${timeAgo(repo.lastCommit.timeMs)}`
                    : repo.error
                      ? "Git refused to read this folder."
                      : "No commits yet"}
                </span>
              </span>
            }
            onClick={() => open.onOpenRepo(repo.path)}
          />
        ))}
      </KitSettingsGroup>
      {truncated && <div className="text-[13px] text-[var(--k-t3)] px-1 py-2">Showing the first {repos.length} repos.</div>}
    </div>
  );
}

function RepoTile(): JSX.Element {
  return (
    <span className="size-8 rounded-[9px] bg-[var(--k-acc-soft)] text-[var(--k-acc-text)] grid place-items-center shrink-0">
      <GitBranch className="size-4" aria-hidden="true" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// One repo: summary card, changes, history, stashes, remotes
// ---------------------------------------------------------------------------

export function AgentGitRepo({
  git,
  repoPath,
  ...open
}: { git: AgentGitState; repoPath: string } & GitOpeners): JSX.Element {
  const state = useLoad(
    () => getGitRepo(git.target, git.hostId, repoPath),
    [targetDepKey(git.target), git.hostId, repoPath, git.refreshKey],
  );
  if (state.status === "loading") return <div className={`${PAD} py-4`}><KitLoading label="Loading repo…" /></div>;
  if (state.status === "error") return <ErrorBanner errorClass={state.errorClass} />;
  return <RepoBody git={git} repoPath={repoPath} detail={state.data} {...open} />;
}

function RepoBody({
  git,
  repoPath,
  detail,
  onOpenCommit,
  onOpenDiff,
}: { git: AgentGitState; repoPath: string; detail: GitRepoDetail } & GitOpeners): JSX.Element {
  const { status, commits, stashes, remotes } = detail;
  const remote = git.remote[repoPath];
  const name = repoLabel(repoPath);
  return (
    <div className={`${PAD} py-4 flex flex-col gap-1`} data-testid="agent-git-repo">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[var(--k-s2)] px-4 py-3.5 mb-3">
        <RepoTile />
        <div className="flex-1 min-w-[180px]">
          <div className="text-[15px] font-semibold truncate">{name}</div>
          <div className="text-[13px] text-[var(--k-t2)] truncate" title={status.upstream ? `Tracks ${status.upstream}` : undefined}>
            {status.branch ?? (status.oid ? `detached at ${status.oid.slice(0, 7)}` : "no branch")}
            {status.upstream ? <span className="text-[var(--k-t3)]"> · tracks {status.upstream}</span> : null}
          </div>
        </div>
        <span className="flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:pl-11">
          <SyncPills {...status} remote={remote} />
          <span className="flex-1" />
          <CheckRemoteButton
            label="Check remote"
            busy={remote?.status === "checking"}
            disabled={!canCheckRemote(status)}
            onClick={() => git.checkRemotes([repoPath])}
          />
          <KitIconButton label="Refresh" size="sm" onClick={git.refresh}>
            <RefreshCw />
          </KitIconButton>
        </span>
      </div>

      <KitSettingsGroup
        title={
          <span className="flex items-center gap-2">
            <span className="flex-1">Changes</span>
            {status.files.length > 0 && (
              <KitButton
                size="sm"
                variant="plain"
                onClick={() =>
                  onOpenDiff({ source: "working", repoPath, path: null }, "Uncommitted changes", name)
                }
                data-testid="agent-git-view-all-changes"
              >
                View all
              </KitButton>
            )}
          </span>
        }
      >
        {status.files.length === 0 ? (
          <KitSettingsRow label={<span className="text-[var(--k-t3)] font-normal">Nothing uncommitted — everything is saved in history.</span>} />
        ) : (
          status.files.map((f) => {
            const c = describeChange(f);
            return (
              <KitSettingsRow
                key={`${f.kind}:${f.path}`}
                data-testid="git-file-row"
                leading={<span className={`w-5 text-center font-mono text-[13px] shrink-0 ${TONE_TEXT[c.tone]}`}>{c.letter}</span>}
                label={<span className="font-mono text-[13px] font-normal break-all">{f.origPath ? `${f.origPath} → ${f.path}` : f.path}</span>}
                description={c.label}
                onClick={() => onOpenDiff({ source: "working", repoPath, path: f.path }, f.path, "Uncommitted change")}
              />
            );
          })
        )}
      </KitSettingsGroup>

      <KitSettingsGroup title={`History${commits.length >= 50 ? " (last 50)" : ""}`}>
        {commits.length === 0 ? (
          <KitSettingsRow label={<span className="text-[var(--k-t3)] font-normal">No commits yet.</span>} />
        ) : (
          commits.map((c) => {
            const refs = c.refs.map((r) => r.replace(/^HEAD -> /, "")).filter((r) => r !== "HEAD");
            return (
              <KitSettingsRow
                key={c.sha}
                data-testid="git-commit-row"
                label={<span className="font-medium">{c.subject}</span>}
                truncate
                description={
                  <>
                    <span className="font-mono text-[12px]">{c.sha.slice(0, 7)}</span>
                    {` · ${c.author} · ${timeAgo(c.timeMs)}`}
                  </>
                }
                value={refs.length ? refs.slice(0, 2).map((r) => <KitChip key={r}>{r}</KitChip>) : undefined}
                onClick={() => onOpenCommit(repoPath, c)}
              />
            );
          })
        )}
      </KitSettingsGroup>

      {stashes.length > 0 && (
        <KitSettingsGroup title={`Stashed work (${stashes.length})`}>
          {stashes.map((s) => (
            <KitSettingsRow
              key={s.ref}
              label={s.message}
              description={
                <>
                  <span className="font-mono text-[12px]">{s.ref}</span>
                  {` · ${timeAgo(s.timeMs)}`}
                </>
              }
            />
          ))}
        </KitSettingsGroup>
      )}

      {remotes.length > 0 && (
        <KitSettingsGroup title="Remotes">
          {remotes.map((r) => (
            <KitSettingsRow key={r.name} label={r.name} description={<span className="font-mono text-[12px] break-all">{r.url}</span>} />
          ))}
        </KitSettingsGroup>
      )}

      <p className="text-[12.5px] text-[var(--k-t3)] mx-1 mt-1">Read-only — nothing here changes the repo.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One commit: its files
// ---------------------------------------------------------------------------

export function AgentGitCommit({
  git,
  repoPath,
  commit,
  onOpenDiff,
}: { git: AgentGitState; repoPath: string; commit: GitCommit; onOpenDiff: GitOpeners["onOpenDiff"] }): JSX.Element {
  const state = useLoad(
    () => getGitDiff(git.target, git.hostId, repoPath, { diff: "commit", sha: commit.sha }),
    [targetDepKey(git.target), git.hostId, repoPath, commit.sha],
  );
  const files = useMemo(() => (state.status === "ready" ? splitPatch(state.data.patch) : []), [state]);
  if (state.status === "loading") return <div className={`${PAD} py-4`}><KitLoading label="Loading the commit…" /></div>;
  if (state.status === "error") return <ErrorBanner errorClass={state.errorClass} />;
  const short = commit.sha.slice(0, 7);
  return (
    <div className={`${PAD} py-4 flex flex-col gap-1`} data-testid="agent-git-commit">
      {state.data.truncated && (
        <KitBanner tone="info" className="mb-2">
          This commit is very large, so only its first files are listed.
        </KitBanner>
      )}
      {files.length === 0 ? (
        <KitEmpty title="No differences to show." />
      ) : (
        <KitSettingsGroup
          title={
            <span className="flex items-center gap-2">
              <span className="flex-1">{files.length === 1 ? "1 file" : `${files.length} files`}</span>
              <KitButton
                size="sm"
                variant="plain"
                onClick={() =>
                  onOpenDiff({ source: "patch", patch: state.data.patch, truncated: state.data.truncated }, commit.subject, `${short} · every file`)
                }
                data-testid="agent-git-commit-all"
              >
                View all
              </KitButton>
            </span>
          }
        >
          {files.map((f, i) => (
            <KitSettingsRow
              // A path that changes type (file ↔ symlink) is two entries.
              key={`${i}:${f.path}`}
              data-testid="git-commit-file-row"
              label={<span className="font-mono text-[13px] font-normal break-all">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>}
              value={<FileCounts file={f} />}
              // A cut-short patch ends partway through its last file.
              onClick={() =>
                onOpenDiff(
                  { source: "patch", patch: f.patch, truncated: state.data.truncated && i === files.length - 1 },
                  f.path,
                  `${short} · ${commit.subject}`,
                )
              }
            />
          ))}
        </KitSettingsGroup>
      )}
    </div>
  );
}

function FileCounts({ file }: { file: PatchFile }): JSX.Element {
  return (
    <span className="font-mono text-[12.5px] whitespace-nowrap">
      <span className="text-[var(--k-ok)]">+{file.added}</span>{" "}
      <span className="text-[var(--k-danger-text)]">−{file.removed}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// A diff
// ---------------------------------------------------------------------------

export function AgentGitDiff({ git, source }: { git: AgentGitState; source: GitDiffSource }): JSX.Element {
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="agent-git-diff">
      <div className={`${PAD} pt-1 pb-2 shrink-0`}>
        <KitSegmented<"unified" | "split">
          aria-label="Diff layout"
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Side by side" },
          ]}
        />
      </div>
      <div className={`flex-1 min-h-0 overflow-auto ${PAD} pb-4`}>
        {source.source === "patch" ? (
          <PatchBody patch={source.patch} truncated={source.truncated === true} layout={layout} />
        ) : (
          <WorkingDiff git={git} source={source} layout={layout} />
        )}
      </div>
    </div>
  );
}

function WorkingDiff({
  git,
  source,
  layout,
}: {
  git: AgentGitState;
  source: Extract<GitDiffSource, { source: "working" }>;
  layout: "unified" | "split";
}): JSX.Element {
  const state = useLoad(
    () => getGitDiff(git.target, git.hostId, source.repoPath, { diff: "working" }),
    [targetDepKey(git.target), git.hostId, source.repoPath, git.refreshKey],
  );
  const patch = useMemo(() => {
    if (state.status !== "ready") return "";
    if (source.path === null) return state.data.patch;
    const want = source.path;
    // A new folder shows in the change list as one "dir/" row, while the
    // diff lists each file inside it — show them all.
    const match = want.endsWith("/")
      ? (f: PatchFile) => f.path.startsWith(want)
      : (f: PatchFile) => f.path === want || f.oldPath === want;
    return splitPatch(state.data.patch)
      .filter(match)
      .map((f) => f.patch)
      .join("");
  }, [state, source.path]);
  if (state.status === "loading") return <KitLoading label="Loading changes…" />;
  if (state.status === "error") return <ErrorBanner errorClass={state.errorClass} />;
  // A file listed as changed but missing from the diff fell past its limits
  // (the first 50 new files; the first 2 MB) — say so, not "no differences".
  if (source.path !== null && patch.trim() === "" && state.data.patch.trim() !== "") {
    return (
      <KitEmpty
        title="This file's changes aren't shown."
        body="The changes view covers the first 50 new files and the first 2 MB of changes."
      />
    );
  }
  return <PatchBody patch={patch} truncated={state.data.truncated} layout={layout} />;
}

function PatchBody({ patch, truncated, layout }: { patch: string; truncated: boolean; layout: "unified" | "split" }): JSX.Element {
  return (
    <>
      {truncated && (
        <KitBanner tone="info" className="mb-2">
          These changes are very large, so only the first part is shown.
        </KitBanner>
      )}
      {patch.trim() === "" ? <KitEmpty title="No differences to show." /> : <DiffView content={patch} layout={layout} />}
    </>
  );
}
