/**
 * Pure parsers for the /workspace/git router. No I/O — every function takes
 * the raw bytes a remote git script printed and returns wire objects.
 *
 * Framing used by the remote scripts (see workspace-git-routes.ts):
 *   RS (0x1e) opens a record, US (0x1f) separates its fields. The first field
 *   is a one-letter tag. A record tagged "X" carries an error class and
 *   aborts the whole response.
 * git's own -z output (NUL separated) lives inside a single field.
 */

const RS = "\x1e";
const US = "\x1f";

type GitFileChange = {
  path: string;
  /** Rename/copy source; null otherwise. */
  origPath: string | null;
  /** Index (staged) state: "." means unchanged. */
  index: string;
  /** Working-tree (unstaged) state: "." means unchanged. */
  worktree: string;
  kind: "changed" | "renamed" | "conflicted" | "untracked";
};

type GitStatus = {
  /** null when HEAD is detached or unknown. */
  branch: string | null;
  detached: boolean;
  /** null before the first commit. */
  oid: string | null;
  upstream: string | null;
  /** null when there is no upstream. */
  ahead: number | null;
  behind: number | null;
  files: GitFileChange[];
};

type GitCommit = {
  sha: string;
  parents: string[];
  author: string;
  timeMs: number;
  refs: string[];
  subject: string;
};

type GitRepoSummary = {
  /** Repo path relative to the workspace root; "" for the root itself. */
  path: string;
  /** Set when git could not read this repo (e.g. ownership check failed). */
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

type GitStash = { ref: string; timeMs: number; message: string };
type GitRemote = { name: string; url: string };

type GitRepoDetail = {
  path: string;
  status: GitStatus;
  commits: GitCommit[];
  stashes: GitStash[];
  remotes: GitRemote[];
};

/** Thrown when a script reported an error record; message is the class. */
export class GitScriptError extends Error {}

type Record_ = { tag: string; fields: string[] };

/** Split script output into tagged records; throws on an "X" record. */
function splitRecords(raw: string): Record_[] {
  const out: Record_[] = [];
  for (const chunk of raw.split(RS)) {
    if (chunk === "") continue;
    const [tag, ...fields] = chunk.split(US);
    if (tag === "X") throw new GitScriptError(fields[0]?.trim() || "git_error");
    out.push({ tag, fields });
  }
  return out;
}

/** `git status --porcelain=v2 --branch -z` → GitStatus. */
function parseStatusV2(raw: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: null,
    behind: null,
    files: [],
  };
  const parts = raw.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry === "") continue;
    if (entry.startsWith("# ")) {
      const [, key, ...rest] = entry.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") status.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") {
        status.detached = value === "(detached)";
        status.branch = status.detached ? null : value;
      } else if (key === "branch.upstream") status.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          status.ahead = Number(m[1]);
          status.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = entry[0];
    if (type === "?") {
      status.files.push({
        path: entry.slice(2),
        origPath: null,
        index: ".",
        worktree: "?",
        kind: "untracked",
      });
    } else if (type === "1" || type === "2" || type === "u") {
      // Field counts before the path: 1 → 8, 2 → 9, u → 10.
      const skip = type === "1" ? 8 : type === "2" ? 9 : 10;
      const fields = entry.split(" ");
      const xy = fields[1] ?? "..";
      const path = fields.slice(skip).join(" ");
      let origPath: string | null = null;
      if (type === "2") {
        // Rename source follows as its own NUL-separated entry.
        origPath = parts[i + 1] ?? null;
        i++;
      }
      status.files.push({
        path,
        origPath,
        index: xy[0],
        worktree: xy[1],
        kind: type === "u" ? "conflicted" : type === "2" ? "renamed" : "changed",
      });
    }
    // "!" (ignored) entries are never requested.
  }
  return status;
}

/** One commit from `%H US %P US %an US %ct US %D US %s`. */
function parseCommitFields(f: string[]): GitCommit | null {
  const [sha, parents, author, ct, refs, ...subject] = f;
  if (!sha || !/^[0-9a-f]{7,64}$/.test(sha.trim())) return null;
  return {
    sha: sha.trim(),
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    author: author ?? "",
    timeMs: Number(ct) * 1000 || 0,
    refs: refs ? refs.split(", ").filter(Boolean) : [],
    subject: subject.join(US),
  };
}

/** `git log -z --format=<commit fields>` → commits. */
function parseLog(raw: string): GitCommit[] {
  return raw
    .split("\0")
    .map((c) => parseCommitFields(c.replace(/^\n/, "").split(US)))
    .filter((c): c is GitCommit => c !== null);
}

/** `git stash list -z --format=%gd US %ct US %gs` → stashes. */
function parseStashes(raw: string): GitStash[] {
  return raw
    .split("\0")
    .filter((s) => s.trim() !== "")
    .map((s) => {
      const [ref, ct, ...msg] = s.replace(/^\n/, "").split(US);
      return { ref, timeMs: Number(ct) * 1000 || 0, message: msg.join(US) };
    });
}

/**
 * Remote URLs can embed credentials (https://x-access-token:TOKEN@host/...).
 * Strip any userinfo before it leaves the backend.
 */
function redactRemoteUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
}

/** `git remote -v` → one entry per remote (fetch URL). */
function parseRemotes(raw: string): GitRemote[] {
  const seen = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const m = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(line.trim());
    if (m && !seen.has(m[1])) seen.set(m[1], redactRemoteUrl(m[2]));
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

function countChanges(status: GitStatus) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const f of status.files) {
    if (f.kind === "untracked") untracked++;
    else if (f.kind === "conflicted") conflicted++;
    else {
      if (f.index !== ".") staged++;
      if (f.worktree !== ".") unstaged++;
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

/** Normalise find's "./a/b" / "." into "a/b" / "". */
function cleanRepoPath(p: string): string {
  if (p === "." || p === "") return "";
  return p.replace(/^\.\//, "");
}

/**
 * Parse the /repos script: one "R" record per repo with fields
 *   [path, statusZ, statusExit, ...lastCommitFields]
 * plus an optional trailing "T" record when the repo list was truncated.
 */
export function parseRepoList(raw: string): { repos: GitRepoSummary[]; truncated: boolean } {
  const repos: GitRepoSummary[] = [];
  let truncated = false;
  for (const rec of splitRecords(raw)) {
    if (rec.tag === "T") {
      truncated = true;
      continue;
    }
    if (rec.tag !== "R") continue;
    const [path, statusZ = "", exit = "1", ...commit] = rec.fields;
    const ok = exit.trim() === "0";
    const status = parseStatusV2(ok ? statusZ : "");
    repos.push({
      path: cleanRepoPath(path ?? ""),
      error: ok ? null : "git_error",
      branch: status.branch,
      detached: status.detached,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      ...countChanges(status),
      lastCommit: ok ? parseCommitFields(commit.map((s) => s.replace(/\n$/, ""))) : null,
    });
  }
  repos.sort((a, b) => a.path.localeCompare(b.path));
  return { repos, truncated };
}

/** Parse the /repo script: S (status), L (log), Z (stashes), M (remotes). */
export function parseRepoDetail(raw: string, path: string): GitRepoDetail {
  const byTag = new Map<string, string[]>();
  for (const rec of splitRecords(raw)) byTag.set(rec.tag, rec.fields);
  const statusFields = byTag.get("S") ?? [];
  if ((statusFields[1] ?? "1").trim() !== "0") throw new GitScriptError("git_error");
  return {
    path,
    status: parseStatusV2(statusFields[0] ?? ""),
    commits: parseLog((byTag.get("L") ?? []).join(US)),
    stashes: parseStashes((byTag.get("Z") ?? []).join(US)),
    remotes: parseRemotes((byTag.get("M") ?? []).join(US)),
  };
}
