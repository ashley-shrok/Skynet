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

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import type { WorkspaceTarget } from "@/api/workspace-api";
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
function describeChange(f: GitFileChange): { letter: string; label: string; hue: number } {
  if (f.kind === "untracked") return { letter: "?", label: "new, not tracked yet", hue: 210 };
  if (f.kind === "conflicted") return { letter: "!", label: "merge conflict", hue: 6 };
  const letter = f.index !== "." ? f.index : f.worktree;
  const where =
    f.index !== "." && f.worktree !== "."
      ? "staged, then edited again"
      : f.index !== "."
        ? "staged"
        : "not staged";
  const hue = letter === "D" ? 6 : letter === "A" ? 140 : 40;
  return { letter, label: `${STATUS_WORD[letter] ?? "changed"} · ${where}`, hue };
}

function repoLabel(path: string): string {
  return path === "" ? "Workspace (root)" : path;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const toolbarBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-pv-fg-muted)",
  background: "var(--color-pv-surface-quiet-alt)",
  border: "1px solid var(--color-pv-border-quiet)",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const linkColor = "hsla(var(--pv-id-hue, 220), 70%, 75%, 1)";

const sectionHeadStyle: CSSProperties = {
  padding: "10px 10px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-pv-fg-dim)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--color-pv-fg)",
  background: "none",
  border: "none",
  textAlign: "left",
};

const monoStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
};

function ErrorBanner({ errorClass }: { errorClass: string }): JSX.Element {
  const copy = errorCopy(errorClass);
  return (
    <div
      role="alert"
      style={{
        background: "hsla(6, 80%, 53%, 0.12)",
        border: "1px solid hsla(6, 80%, 53%, 0.28)",
        borderRadius: 8,
        padding: "10px 14px",
        margin: "8px 10px",
        color: "var(--color-pv-fg)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{copy.heading}</div>
      <div style={{ fontSize: 12, color: "var(--color-pv-fg-muted)" }}>{copy.body}</div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ padding: "16px 10px", fontSize: 13, color: "var(--color-pv-fg-muted)" }}>
      {children}
    </div>
  );
}

function Pill({ children, hue, title }: { children: ReactNode; hue?: number; title?: string }): JSX.Element {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 11.5,
        whiteSpace: "nowrap",
        color: hue === undefined ? "var(--color-pv-fg-muted)" : `hsla(${hue}, 70%, 75%, 1)`,
        background: hue === undefined ? "var(--color-pv-surface-quiet-alt)" : `hsla(${hue}, 70%, 55%, 0.14)`,
        border: `1px solid ${hue === undefined ? "var(--color-pv-border-quiet)" : `hsla(${hue}, 70%, 65%, 0.28)`}`,
      }}
    >
      {children}
    </span>
  );
}

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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px 6px",
        flexShrink: 0,
        borderBottom: "1px solid var(--color-pv-border-quiet)",
      }}
    >
      {onBack && (
        <button type="button" style={{ ...toolbarBtnStyle, padding: "5px 8px" }} onClick={onBack} title="Back">
          <ChevronLeft size={13} />
        </button>
      )}
      <nav
        aria-label="Repo path"
        style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 0, flexWrap: "wrap" }}
      >
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            {i > 0 && <ChevronRight size={13} style={{ color: "var(--color-pv-fg-dim)", margin: "0 1px" }} />}
            <button
              type="button"
              onClick={c.onClick}
              disabled={!c.onClick}
              style={{
                background: "none",
                border: "none",
                padding: "2px 4px",
                fontSize: 13,
                fontWeight: 600,
                color: c.onClick ? linkColor : "var(--color-pv-fg)",
                cursor: c.onClick ? "pointer" : "default",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </button>
          </span>
        ))}
      </nav>
      {actions}
      <button type="button" style={{ ...toolbarBtnStyle, padding: "5px 8px" }} onClick={onRefresh} title="Refresh">
        <RefreshCw size={13} />
      </button>
    </div>
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
  if (detached) return <Pill hue={40} title="Not on a branch — checked out at a specific commit">Detached</Pill>;
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
        <Pill hue={140} title={`${a} commit(s) not yet pushed to ${upstream} (${asOf})`}>
          <ArrowUp size={11} />
          {a}
        </Pill>
      )}
      {!!b && (
        <Pill hue={210} title={`${b} commit(s) on ${upstream} not pulled yet (${asOf})`}>
          <ArrowDown size={11} />
          {b}
        </Pill>
      )}
      {fresh && (
        <Pill hue={140} title={`Counts ${asOf}`}>
          <RadioTower size={11} />
          live
        </Pill>
      )}
      {remote?.status === "error" && (
        <Pill hue={6} title={errorCopy(remote.errorClass).body}>
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
    <button
      type="button"
      style={{ ...toolbarBtnStyle, opacity: disabled || busy ? 0.6 : 1, cursor: disabled || busy ? "default" : "pointer" }}
      disabled={disabled || busy}
      onClick={onClick}
      title="Ask the remote for up-to-date push/pull counts. Doesn't change the agent's branches or files."
    >
      <RadioTower size={13} />
      {busy ? "Checking…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RepoListView
// ---------------------------------------------------------------------------

function ChangeSummary({ repo }: { repo: GitRepoSummary }): JSX.Element {
  const parts: ReactNode[] = [];
  if (repo.conflicted) parts.push(<Pill key="c" hue={6}>{repo.conflicted} conflicted</Pill>);
  if (repo.staged) parts.push(<Pill key="s" hue={140}>{repo.staged} staged</Pill>);
  if (repo.unstaged) parts.push(<Pill key="u" hue={40}>{repo.unstaged} modified</Pill>);
  if (repo.untracked) parts.push(<Pill key="n" hue={210}>{repo.untracked} new</Pill>);
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
      <div style={{ padding: "6px 10px 8px", fontSize: 12, color: "var(--color-pv-fg-muted)", flexShrink: 0 }}>
        {introCopy}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 4px 8px" }}>
        {state.status === "loading" && <Notice>Looking for repos…</Notice>}
        {state.status === "error" && <ErrorBanner errorClass={state.errorClass} />}
        {state.status === "ready" && state.data.repos.length === 0 && <Notice>No git repos here yet.</Notice>}
        {state.status === "ready" &&
          state.data.repos.map((repo) => (
            <button
              key={repo.path}
              type="button"
              data-testid="git-repo-row"
              onClick={() => onOpen(repo.path)}
              className="hover:bg-white/5"
              style={{ ...rowStyle, alignItems: "flex-start", cursor: "pointer", padding: "8px 10px" }}
            >
              <FolderGit2 size={16} style={{ color: linkColor, flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{repoLabel(repo.path)}</span>
                  {repo.branch && (
                    <Pill>
                      <GitBranch size={11} />
                      {repo.branch}
                    </Pill>
                  )}
                  {repo.error ? (
                    <Pill hue={6} title="Git couldn't read this repo">
                      <AlertTriangle size={11} />
                      Unreadable
                    </Pill>
                  ) : (
                    <>
                      <SyncPills {...repo} remote={remote[repo.path]} />
                      <ChangeSummary repo={repo} />
                    </>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--color-pv-fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {repo.lastCommit
                    ? `${repo.lastCommit.subject} · ${timeAgo(repo.lastCommit.timeMs)}`
                    : repo.error
                      ? "Git refused to read this folder."
                      : "No commits yet"}
                </div>
              </div>
            </button>
          ))}
        {state.status === "ready" && state.data.truncated && (
          <Notice>Showing the first {state.data.repos.length} repos.</Notice>
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
    <button
      type="button"
      data-testid="git-commit-row"
      onClick={onOpen}
      className="hover:bg-white/5"
      style={{ ...rowStyle, cursor: "pointer" }}
      title="Show what this commit changed"
    >
      <GitCommitHorizontal size={14} style={{ color: "var(--color-pv-fg-dim)", flexShrink: 0 }} />
      <span style={{ ...monoStyle, color: "var(--color-pv-fg-dim)", flexShrink: 0 }}>{commit.sha.slice(0, 7)}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {commit.subject}
      </span>
      {refs.slice(0, 2).map((r) => (
        <Pill key={r}>{r}</Pill>
      ))}
      <span style={{ fontSize: 12, color: "var(--color-pv-fg-muted)", flexShrink: 0 }}>
        {commit.author} · {timeAgo(commit.timeMs)}
      </span>
    </button>
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 4px 8px" }}>
        {state.status === "loading" && <Notice>Loading repo…</Notice>}
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 10px 2px" }}>
        <Pill>
          <GitBranch size={11} />
          {status.branch ?? (status.oid ? `detached at ${status.oid.slice(0, 7)}` : "no branch")}
        </Pill>
        {status.upstream && <Pill title="Remote branch this one tracks">tracks {status.upstream}</Pill>}
        <SyncPills {...status} remote={remote} />
      </div>

      <div style={{ ...sectionHeadStyle, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>Uncommitted changes ({status.files.length})</span>
        {status.files.length > 0 && (
          <button
            type="button"
            style={{ ...toolbarBtnStyle, textTransform: "none", letterSpacing: 0 }}
            onClick={() => onOpenDiff({ diff: "working" }, "Uncommitted changes")}
          >
            View changes
          </button>
        )}
      </div>
      {status.files.length === 0 && <Notice>Nothing uncommitted — everything is saved in history.</Notice>}
      {status.files.map((f) => {
        const c = describeChange(f);
        return (
          <div key={`${f.kind}:${f.path}`} data-testid="git-file-row" style={rowStyle} title={c.label}>
            <span
              style={{
                ...monoStyle,
                width: 18,
                textAlign: "center",
                fontWeight: 700,
                color: `hsla(${c.hue}, 70%, 70%, 1)`,
                flexShrink: 0,
              }}
            >
              {c.letter}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-pv-fg-muted)", flexShrink: 0 }}>{c.label}</span>
          </div>
        );
      })}

      <div style={sectionHeadStyle}>History{commits.length >= 50 ? " (last 50)" : ""}</div>
      {commits.length === 0 && <Notice>No commits yet.</Notice>}
      {commits.map((c) => (
        <CommitRow
          key={c.sha}
          commit={c}
          onOpen={() => onOpenDiff({ diff: "commit", sha: c.sha }, `${c.sha.slice(0, 7)} ${c.subject}`)}
        />
      ))}

      {stashes.length > 0 && (
        <>
          <div style={sectionHeadStyle}>Stashed work ({stashes.length})</div>
          {stashes.map((s) => (
            <div key={s.ref} style={rowStyle}>
              <span style={{ ...monoStyle, color: "var(--color-pv-fg-dim)" }}>{s.ref}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.message}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-pv-fg-muted)" }}>{timeAgo(s.timeMs)}</span>
            </div>
          ))}
        </>
      )}

      {remotes.length > 0 && (
        <>
          <div style={sectionHeadStyle}>Remotes</div>
          {remotes.map((r) => (
            <div key={r.name} style={rowStyle}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span style={{ ...monoStyle, color: "var(--color-pv-fg-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.url}
              </span>
            </div>
          ))}
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
      <div style={{ display: "flex", gap: 4, padding: "6px 10px", flexShrink: 0 }}>
        {(["unified", "split"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayout(l)}
            aria-pressed={layout === l}
            style={{
              ...toolbarBtnStyle,
              color: layout === l ? "var(--color-pv-fg)" : "var(--color-pv-fg-muted)",
              background: layout === l ? "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.14)" : toolbarBtnStyle.background,
            }}
          >
            {l === "unified" ? "Unified" : "Side by side"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 10px 8px" }}>
        {state.status === "loading" && <Notice>Loading changes…</Notice>}
        {state.status === "error" && <ErrorBanner errorClass={state.errorClass} />}
        {state.status === "ready" && state.data.truncated && (
          <Notice>This change is very large, so only the first part is shown.</Notice>
        )}
        {state.status === "ready" &&
          (state.data.patch.trim() === "" ? (
            <Notice>No differences to show.</Notice>
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--color-pv-surface-quiet)",
      }}
    >
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
