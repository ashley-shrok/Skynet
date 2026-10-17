/**
 * GitTab — read-only view of the git repos inside an identity's workspace.
 *
 * Sibling of WorkspaceTab (the Files tab) with the same shape: one component
 * that swaps between inline sub-views, no modal stacking, snapshot fetch on
 * mount + a refresh button (no polling).
 *
 *   GitTab (default export)
 *     ├─ RepoListView   — every repo: branch, sync state, change counts, last commit
 *     ├─ RepoDetailView — one repo: changed files, history, stashes, remotes
 *     └─ DiffPane       — working-tree or per-commit patch via the shared DiffView
 *
 * Nothing here changes a repo: no commit, checkout, push or pull. "Check
 * remote" downloads the upstream branch into a private ref that is deleted
 * straight after (see buildRemoteCheckScript), so the agent's branches and
 * origin/* refs never move. Agents own their repos.
 *
 * The modals only show this tab when useHasGitRepos (use-has-git-repos.ts)
 * finds a repo.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import type { WorkspaceTarget } from "@/api/workspace-git-api";
import {
  checkGitRemote,
  getGitDiff,
  getGitRepo,
  listGitRepos,
  type GitCommit,
  type GitRemoteCheck,
  type GitDiffResponse,
  type GitDiffSpec,
  type GitFileChange,
  type GitRepoDetail,
  type GitReposResponse,
  type GitRepoSummary,
} from "@/api/workspace-git-api";
import {
  KitBanner,
  KitButton,
  KitChip,
  KitCrumbs,
  KitEmpty,
  KitIconButton,
  KitList,
  KitListHead,
  KitListRow,
  KitLoading,
  KitSegmented,
  KitToolbar,
  type KitChipTone,
} from "@/components/kit";
import { DiffView } from "./file-viewers/diff/DiffView";
import { resolveWorkspaceErrorCopy, type WorkspaceErrorCopy } from "./workspace-error-copy";

// ---------------------------------------------------------------------------
// Copy + formatting
// ---------------------------------------------------------------------------

const GIT_ERROR_COPY: Record<string, WorkspaceErrorCopy> = {
  git_missing: {
    heading: "Git isn't installed",
    body: "This box doesn't have git, so there's no history to show.",
  },
  not_found: {
    heading: "Not found",
    body: "That repo or change is no longer there. Refresh and try again.",
  },
  not_a_repo: {
    heading: "Not a repo",
    body: "That folder isn't tracked by git any more. Refresh and try again.",
  },
  git_error: {
    heading: "Couldn't read this repo",
    body: "Git refused to read it. Ask the agent to check the repo is healthy.",
  },
  no_upstream: {
    heading: "Nothing to compare with",
    body: "This branch doesn't track a remote branch.",
  },
  fetch_failed: {
    heading: "Couldn't reach the remote",
    body: "The remote didn't answer or needs credentials this box doesn't have.",
  },
};

function errorCopy(errorClass: string): WorkspaceErrorCopy {
  return GIT_ERROR_COPY[errorClass] ?? resolveWorkspaceErrorCopy(errorClass);
}

function errorClassOf(err: unknown): string {
  return err instanceof Error ? err.message : "host_unreachable";
}

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const mins = Math.floor(Math.max(0, Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_WORD: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
};

/** One-letter badge + description for a changed file. */
function describeChange(f: GitFileChange): { letter: string; label: string; tone: KitChipTone } {
  if (f.kind === "untracked") return { letter: "?", label: "new, not tracked yet", tone: "accent" };
  if (f.kind === "conflicted") return { letter: "!", label: "merge conflict", tone: "danger" };
  const letter = f.index !== "." ? f.index : f.worktree;
  const where =
    f.index !== "." && f.worktree !== "."
      ? "staged, then edited again"
      : f.index !== "."
        ? "staged"
        : "not staged";
  const tone: KitChipTone = letter === "D" ? "danger" : letter === "A" ? "ok" : "warn";
  return { letter, label: `${STATUS_WORD[letter] ?? "changed"} · ${where}`, tone };
}

function repoLabel(path: string): string {
  return path === "" ? "Workspace (root)" : path;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Letter colour for a change badge, matching the chip tones. */
const TONE_TEXT: Record<KitChipTone, string> = {
  neutral: "text-[var(--k-t2)]",
  accent: "text-[var(--k-acc-text)]",
  ok: "text-[var(--k-ok)]",
  warn: "text-[var(--k-warn)]",
  danger: "text-[var(--k-danger-text)]",
};

function ErrorBanner({ errorClass }: { errorClass: string }): JSX.Element {
  const copy = errorCopy(errorClass);
  return (
    <KitBanner tone="danger" className="mx-2.5 my-2">
      <div className="font-semibold">{copy.heading}</div>
      <div className="text-[12.5px] opacity-85">{copy.body}</div>
    </KitBanner>
  );
}

/** A quiet line of text inside a list (e.g. "No commits yet."). */
function Note({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-2.5 py-3 text-[13px] text-[var(--k-t3)]">{children}</div>;
}

const Pill = KitChip;

/** Toolbar: optional back button, breadcrumb trail, extra actions, refresh. */
function Toolbar({
  crumbs,
  onBack,
  onRefresh,
  actions,
}: {
  crumbs: { label: string; onClick?: () => void }[];
  onBack?: () => void;
  onRefresh: () => void;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <KitToolbar className="mx-2.5 mt-1 mb-1.5 shrink-0 flex-nowrap" aria-label="Git">
      {onBack && (
        <KitIconButton label="Back" size="sm" onClick={onBack}>
          <ChevronLeft />
        </KitIconButton>
      )}
      <KitCrumbs aria-label="Repo path" crumbs={crumbs} className="flex-1" />
      {actions}
      <KitIconButton label="Refresh" size="sm" onClick={onRefresh}>
        <RefreshCw />
      </KitIconButton>
    </KitToolbar>
  );
}

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; errorClass: string };

/** Fetch on mount and whenever `deps` change; stale responses are dropped. */
function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetcher().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (err) => !cancelled && setState({ status: "error", errorClass: errorClassOf(err) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function targetDepKey(t: WorkspaceTarget): string {
  return t.kind === "identity" ? `identity:${t.identityKey}` : `role:${t.roleSlug}`;
}

// ---------------------------------------------------------------------------
// Remote checks
// ---------------------------------------------------------------------------

type RemoteState =
  | { status: "checking" }
  | { status: "done"; result: GitRemoteCheck }
  | { status: "error"; errorClass: string };

type RemoteChecks = Record<string, RemoteState>;

/** Remote checks in flight at once when checking a whole list. */
const REMOTE_CHECK_CONCURRENCY = 3;

function canCheckRemote(s: Pick<GitRepoSummary, "upstream" | "detached">): boolean {
  return !!s.upstream && !s.detached;
}

/** Ahead/behind pills — from a fresh remote check when there is one. */
function SyncPills({
  upstream,
  ahead,
  behind,
  detached,
  remote,
}: Pick<GitRepoSummary, "upstream" | "ahead" | "behind" | "detached"> & {
  remote?: RemoteState;
}): JSX.Element {
  if (detached) return <Pill tone="warn" title="Not on a branch — checked out at a specific commit">Detached</Pill>;
  if (!upstream) return <Pill title="This branch has no remote copy to push to">Local only</Pill>;
  if (remote?.status === "checking") return <Pill>Checking remote…</Pill>;

  const fresh = remote?.status === "done" ? remote.result : null;
  const a = fresh ? fresh.ahead : ahead;
  const b = fresh ? fresh.behind : behind;
  const asOf = fresh ? `checked with the remote ${timeAgo(fresh.checkedAtMs)}` : "as of the agent's last fetch";
  return (
    <>
      {!a && !b && <Pill title={`Matches ${upstream} (${asOf})`}>In sync</Pill>}
      {!!a && (
        <Pill tone="ok" title={`${a} commit(s) not yet pushed to ${upstream} (${asOf})`}>
          <ArrowUp size={11} />
          {a}
        </Pill>
      )}
      {!!b && (
        <Pill tone="accent" title={`${b} commit(s) on ${upstream} not pulled yet (${asOf})`}>
          <ArrowDown size={11} />
          {b}
        </Pill>
      )}
      {fresh && (
        <Pill tone="ok" title={`Counts ${asOf}`}>
          <RadioTower size={11} />
          live
        </Pill>
      )}
      {remote?.status === "error" && (
        <Pill tone="danger" title={errorCopy(remote.errorClass).body}>
          <AlertTriangle size={11} />
          {errorCopy(remote.errorClass).heading}
        </Pill>
      )}
    </>
  );
}

function CheckRemoteButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <KitButton
      size="sm"
      busy={busy}
      disabled={disabled}
      onClick={onClick}
      title="Ask the remote for up-to-date push/pull counts. Doesn't change the agent's branches or files."
    >
      {busy ? null : <RadioTower size={13} aria-hidden="true" />}
      {busy ? "Checking…" : label}
    </KitButton>
  );
}

// ---------------------------------------------------------------------------
// RepoListView
// ---------------------------------------------------------------------------

function ChangeSummary({ repo }: { repo: GitRepoSummary }): JSX.Element {
  const parts: ReactNode[] = [];
  if (repo.conflicted) parts.push(<Pill key="c" tone="danger">{repo.conflicted} conflicted</Pill>);
  if (repo.staged) parts.push(<Pill key="s" tone="ok">{repo.staged} staged</Pill>);
  if (repo.unstaged) parts.push(<Pill key="u" tone="warn">{repo.unstaged} modified</Pill>);
  if (repo.untracked) parts.push(<Pill key="n" tone="accent">{repo.untracked} new</Pill>);
  if (parts.length === 0) parts.push(<Pill key="clean">Clean</Pill>);
  return <>{parts}</>;
}

function RepoListView({
  state,
  introCopy,
  remote,
  onCheckRemotes,
  onOpen,
  onRefresh,
}: {
  state: Load<GitReposResponse>;
  introCopy: string;
  remote: RemoteChecks;
  onCheckRemotes: (paths: string[]) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}): JSX.Element {
  const checkable = state.status === "ready" ? state.data.repos.filter((r) => !r.error && canCheckRemote(r)) : [];
  const busy = Object.values(remote).some((r) => r.status === "checking");
  return (
    <>
      <Toolbar
        crumbs={[{ label: "Repos" }]}
        onRefresh={onRefresh}
        actions={
          <CheckRemoteButton
            label="Check remotes"
            busy={busy}
            disabled={checkable.length === 0}
            onClick={() => onCheckRemotes(checkable.map((r) => r.path))}
          />
        }
      />
      <div className="px-3.5 pt-1.5 pb-2 text-[12.5px] text-[var(--k-t3)] shrink-0">{introCopy}</div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
        {state.status === "loading" && <KitLoading label="Looking for repos…" className="px-2.5" />}
        {state.status === "error" && <ErrorBanner errorClass={state.errorClass} />}
        {state.status === "ready" && state.data.repos.length === 0 && (
          <KitEmpty icon={<FolderGit2 aria-hidden="true" />} title="No git repos here yet." />
        )}
        {state.status === "ready" && state.data.repos.length > 0 && (
          <KitList>
            {state.data.repos.map((repo) => (
              <KitListRow
                key={repo.path}
                data-testid="git-repo-row"
                onActivate={() => onOpen(repo.path)}
                avatar={<FolderGit2 size={18} aria-hidden="true" />}
                avatarShape="square"
                title={repoLabel(repo.path)}
                wrapSubtitle
                subtitle={
                  <span className="flex flex-col gap-1.5 pt-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {repo.branch && (
                        <Pill>
                          <GitBranch size={11} aria-hidden="true" />
                          {repo.branch}
                        </Pill>
                      )}
                      {repo.error ? (
                        <Pill tone="danger" title="Git couldn't read this repo">
                          <AlertTriangle size={11} aria-hidden="true" />
                          Unreadable
                        </Pill>
                      ) : (
                        <>
                          <SyncPills {...repo} remote={remote[repo.path]} />
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
              />
            ))}
          </KitList>
        )}
        {state.status === "ready" && state.data.truncated && (
          <Note>Showing the first {state.data.repos.length} repos.</Note>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RepoDetailView
// ---------------------------------------------------------------------------

function CommitRow({ commit, onOpen }: { commit: GitCommit; onOpen: () => void }): JSX.Element {
  const refs = commit.refs.map((r) => r.replace(/^HEAD -> /, "")).filter((r) => r !== "HEAD");
  return (
    <KitListRow
      data-testid="git-commit-row"
      onActivate={onOpen}
      title={commit.subject}
      subtitle={
        <>
          <span className="font-mono text-[12px]">{commit.sha.slice(0, 7)}</span>
          {` · ${commit.author} · ${timeAgo(commit.timeMs)}`}
        </>
      }
      trailing={
        refs.length > 0 ? (
          <>
            {refs.slice(0, 2).map((r) => (
              <Pill key={r}>{r}</Pill>
            ))}
          </>
        ) : undefined
      }
    />
  );
}

function RepoDetailView({
  repoPath,
  state,
  remote,
  onCheckRemote,
  onBack,
  onRefresh,
  onOpenDiff,
}: {
  repoPath: string;
  state: Load<GitRepoDetail>;
  remote?: RemoteState;
  onCheckRemote: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onOpenDiff: (spec: GitDiffSpec, title: string) => void;
}): JSX.Element {
  const checkable = state.status === "ready" && canCheckRemote(state.data.status);
  return (
    <>
      <Toolbar
        crumbs={[{ label: "Repos", onClick: onBack }, { label: repoLabel(repoPath) }]}
        onBack={onBack}
        onRefresh={onRefresh}
        actions={
          <CheckRemoteButton
            label="Check remote"
            busy={remote?.status === "checking"}
            disabled={!checkable}
            onClick={onCheckRemote}
          />
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
        {state.status === "loading" && <KitLoading label="Loading repo…" className="px-2.5" />}
        {state.status === "error" && <ErrorBanner errorClass={state.errorClass} />}
        {state.status === "ready" && <RepoDetailBody detail={state.data} remote={remote} onOpenDiff={onOpenDiff} />}
      </div>
    </>
  );
}

function RepoDetailBody({
  detail,
  remote,
  onOpenDiff,
}: {
  detail: GitRepoDetail;
  remote?: RemoteState;
  onOpenDiff: (spec: GitDiffSpec, title: string) => void;
}): JSX.Element {
  const { status, commits, stashes, remotes } = detail;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2 pb-0.5">
        <Pill>
          <GitBranch size={11} aria-hidden="true" />
          {status.branch ?? (status.oid ? `detached at ${status.oid.slice(0, 7)}` : "no branch")}
        </Pill>
        {status.upstream && <Pill title="Remote branch this one tracks">tracks {status.upstream}</Pill>}
        <SyncPills {...status} remote={remote} />
      </div>

      <KitListHead className="flex items-center gap-2">
        <span className="flex-1">Uncommitted changes ({status.files.length})</span>
        {status.files.length > 0 && (
          <KitButton size="sm" variant="plain" onClick={() => onOpenDiff({ diff: "working" }, "Uncommitted changes")}>
            View changes
          </KitButton>
        )}
      </KitListHead>
      {status.files.length === 0 && <Note>Nothing uncommitted — everything is saved in history.</Note>}
      {status.files.length > 0 && (
        <KitList>
          {status.files.map((f) => {
            const c = describeChange(f);
            return (
              <KitListRow
                key={`${f.kind}:${f.path}`}
                data-testid="git-file-row"
                avatar={<span className={`font-mono text-[13px] ${TONE_TEXT[c.tone]}`}>{c.letter}</span>}
                avatarShape="square"
                className="[&>.k-item-av]:size-7 py-1.5"
                title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                subtitle={c.label}
              />
            );
          })}
        </KitList>
      )}

      <KitListHead>History{commits.length >= 50 ? " (last 50)" : ""}</KitListHead>
      {commits.length === 0 && <Note>No commits yet.</Note>}
      {commits.length > 0 && (
        <KitList>
          {commits.map((c) => (
            <CommitRow
              key={c.sha}
              commit={c}
              onOpen={() => onOpenDiff({ diff: "commit", sha: c.sha }, `${c.sha.slice(0, 7)} ${c.subject}`)}
            />
          ))}
        </KitList>
      )}

      {stashes.length > 0 && (
        <>
          <KitListHead>Stashed work ({stashes.length})</KitListHead>
          <KitList>
            {stashes.map((s) => (
              <KitListRow
                key={s.ref}
                title={s.message}
                subtitle={
                  <>
                    <span className="font-mono text-[12px]">{s.ref}</span>
                    {` · ${timeAgo(s.timeMs)}`}
                  </>
                }
              />
            ))}
          </KitList>
        </>
      )}

      {remotes.length > 0 && (
        <>
          <KitListHead>Remotes</KitListHead>
          <KitList>
            {remotes.map((r) => (
              <KitListRow
                key={r.name}
                title={r.name}
                subtitle={<span className="font-mono text-[12px]">{r.url}</span>}
              />
            ))}
          </KitList>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// DiffPane
// ---------------------------------------------------------------------------

function DiffPane({
  repoPath,
  title,
  state,
  onBackToRepos,
  onBack,
  onRefresh,
}: {
  repoPath: string;
  title: string;
  state: Load<GitDiffResponse>;
  onBackToRepos: () => void;
  onBack: () => void;
  onRefresh: () => void;
}): JSX.Element {
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  return (
    <>
      <Toolbar
        crumbs={[
          { label: "Repos", onClick: onBackToRepos },
          { label: repoLabel(repoPath), onClick: onBack },
          { label: title },
        ]}
        onBack={onBack}
        onRefresh={onRefresh}
      />
      <div className="px-2.5 pt-1 pb-1.5 shrink-0">
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
      <div className="flex-1 min-h-0 overflow-auto px-2.5 pb-2">
        {state.status === "loading" && <KitLoading label="Loading changes…" />}
        {state.status === "error" && <ErrorBanner errorClass={state.errorClass} />}
        {state.status === "ready" && state.data.truncated && (
          <KitBanner tone="info" className="mb-2">
            This change is very large, so only the first part is shown.
          </KitBanner>
        )}
        {state.status === "ready" &&
          (state.data.patch.trim() === "" ? (
            <KitEmpty title="No differences to show." />
          ) : (
            <DiffView content={state.data.patch} layout={layout} />
          ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// GitTab — default export
// ---------------------------------------------------------------------------

export interface GitTabProps {
  target: WorkspaceTarget;
  hostId: number;
  hue: number;
  /** Intro copy above the repo list. Identity default when absent. */
  introCopy?: string;
}

type View =
  | { mode: "list" }
  | { mode: "repo"; repoPath: string }
  | { mode: "diff"; repoPath: string; spec: GitDiffSpec; title: string };

const DEFAULT_INTRO =
  "Git repos in this agent's workspace and what's changed in each. Read-only — the agent makes the commits.";

export default function GitTab({ target, hostId, introCopy }: GitTabProps): JSX.Element {
  const [view, setView] = useState<View>({ mode: "list" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [remote, setRemote] = useState<RemoteChecks>({});
  // Bumped on refresh/target change so late remote-check answers are dropped.
  const generation = useRef(0);
  const tk = targetDepKey(target);

  useEffect(() => {
    generation.current++;
    setRemote({});
  }, [tk, hostId]);

  const refresh = () => {
    // Remote counts are relative to HEAD at check time — drop them with the rest.
    generation.current++;
    setRemote({});
    setRefreshKey((k) => k + 1);
  };

  const checkRemotes = useCallback(
    (paths: string[]) => {
      const gen = generation.current;
      const queue = [...paths];
      setRemote((prev) => ({ ...prev, ...Object.fromEntries(paths.map((p) => [p, { status: "checking" } as const])) }));
      const worker = async () => {
        for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
          const path = p;
          let next: RemoteState;
          try {
            next = { status: "done", result: await checkGitRemote(target, hostId, path) };
          } catch (err) {
            next = { status: "error", errorClass: errorClassOf(err) };
          }
          if (generation.current !== gen) return;
          setRemote((prev) => ({ ...prev, [path]: next }));
        }
      };
      for (let i = 0; i < Math.min(REMOTE_CHECK_CONCURRENCY, paths.length); i++) void worker();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tk, hostId],
  );

  // Each view fetches only while shown; going back refetches (cheap, and the
  // agent may have changed things in the meantime).
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {view.mode === "list" && (
        <RepoListLoader
          target={target}
          hostId={hostId}
          deps={[tk, hostId, refreshKey]}
          introCopy={introCopy ?? DEFAULT_INTRO}
          remote={remote}
          onCheckRemotes={checkRemotes}
          onOpen={(repoPath) => setView({ mode: "repo", repoPath })}
          onRefresh={refresh}
        />
      )}
      {view.mode === "repo" && (
        <RepoDetailLoader
          target={target}
          hostId={hostId}
          repoPath={view.repoPath}
          deps={[tk, hostId, view.repoPath, refreshKey]}
          remote={remote[view.repoPath]}
          onCheckRemote={() => checkRemotes([view.repoPath])}
          onBack={() => setView({ mode: "list" })}
          onRefresh={refresh}
          onOpenDiff={(spec, title) => setView({ mode: "diff", repoPath: view.repoPath, spec, title })}
        />
      )}
      {view.mode === "diff" && (
        <DiffLoader
          target={target}
          hostId={hostId}
          view={view}
          deps={[tk, hostId, view.repoPath, JSON.stringify(view.spec), refreshKey]}
          onBackToRepos={() => setView({ mode: "list" })}
          onBack={() => setView({ mode: "repo", repoPath: view.repoPath })}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

function RepoListLoader(props: {
  target: WorkspaceTarget;
  hostId: number;
  deps: unknown[];
  introCopy: string;
  remote: RemoteChecks;
  onCheckRemotes: (paths: string[]) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}): JSX.Element {
  const state = useLoad(() => listGitRepos(props.target, props.hostId), props.deps);
  return (
    <RepoListView
      state={state}
      introCopy={props.introCopy}
      remote={props.remote}
      onCheckRemotes={props.onCheckRemotes}
      onOpen={props.onOpen}
      onRefresh={props.onRefresh}
    />
  );
}

function RepoDetailLoader(props: {
  target: WorkspaceTarget;
  hostId: number;
  repoPath: string;
  deps: unknown[];
  remote?: RemoteState;
  onCheckRemote: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onOpenDiff: (spec: GitDiffSpec, title: string) => void;
}): JSX.Element {
  const state = useLoad(() => getGitRepo(props.target, props.hostId, props.repoPath), props.deps);
  return (
    <RepoDetailView
      repoPath={props.repoPath}
      state={state}
      remote={props.remote}
      onCheckRemote={props.onCheckRemote}
      onBack={props.onBack}
      onRefresh={props.onRefresh}
      onOpenDiff={props.onOpenDiff}
    />
  );
}

function DiffLoader(props: {
  target: WorkspaceTarget;
  hostId: number;
  view: Extract<View, { mode: "diff" }>;
  deps: unknown[];
  onBackToRepos: () => void;
  onBack: () => void;
  onRefresh: () => void;
}): JSX.Element {
  const { view } = props;
  const state = useLoad(
    () => getGitDiff(props.target, props.hostId, view.repoPath, view.spec),
    props.deps,
  );
  return (
    <DiffPane
      repoPath={view.repoPath}
      title={view.title}
      state={state}
      onBackToRepos={props.onBackToRepos}
      onBack={props.onBack}
      onRefresh={props.onRefresh}
    />
  );
}
