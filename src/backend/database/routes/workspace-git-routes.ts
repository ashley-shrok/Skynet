/**
 * Read-only git view over an identity workspace (or role folder).
 *
 * Three endpoints under /workspace/git (mounted in database.ts):
 *   POST /repos — every git repo under the workspace (find, depth ≤ 4) with
 *                 branch, ahead/behind, change counts and last commit
 *   POST /repo  — one repo: full status, last 50 commits, stashes, remotes
 *   POST /diff  — unified patch: working tree vs HEAD (incl. untracked
 *                 files), or one commit vs its first parent
 *                 (body.diff = "working" | "commit" + sha)
 *
 * Same request chain as workspace-routes.ts (body check → extractTarget →
 * traversal check → resolveHostById → canAccessHost "read" → pooled SSH),
 * except step 9 runs a fixed git script on an exec channel instead of SFTP.
 *
 * Safety:
 *   - Nothing client-supplied is interpolated unquoted. Paths go through
 *     shellEscape; shas are hex-validated; identity/role keys are regex-checked.
 *   - The script `cd`s into the repo and checks `pwd -P` is under the
 *     workspace root's `pwd -P` (symlink escape, mirrors assertResolvedUnderRoot).
 *   - Read-only git: GIT_OPTIONAL_LOCKS=0 so `status` never takes index.lock
 *     out from under an agent mid-commit; fsmonitor off; --no-ext-diff and
 *     --no-textconv so repo config can't swap in external diff programs.
 *     Repo config is otherwise honoured — it runs as the same host user the
 *     agent already is, so it grants nothing new.
 *   - Output is capped on the host (head -c) and again here.
 *   - Remote URLs are stripped of embedded credentials before responding.
 *   - Error bodies are { error: "<class>" } only — never err.message (T-40-05).
 */

import express from "express";
import type { Request, Response } from "express";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import {
  classifyErrorToClass,
  classifyErrorToStatus,
  extractTarget,
  runWithAbort,
  validateRelativePath,
  type TargetSpec,
} from "./workspace-routes.js";
import {
  GitScriptError,
  parseRepoDetail,
  parseRepoList,
} from "./workspace-git-parse.js";

/* ------------------------------------------------------------------------ */
/*  Constants                                                               */
/* ------------------------------------------------------------------------ */

const SSH_CONNECT_TIMEOUT_MS = 5_000;
/** Generous for git status on a big repo, but under nginx's 15s proxy_read_timeout on /workspace. */
const GIT_OP_TIMEOUT_MS = 14_000;
/** Most repos /repos reports; one more is fetched to detect truncation. */
const MAX_REPOS = 50;
/** Cap on status/log output for /repos and /repo. */
const MAX_META_BYTES = 4_000_000;
/** Cap on a returned patch; anything past it is cut and flagged. */
const MAX_PATCH_BYTES = 2_000_000;
/** Untracked files folded into the working-tree diff. */
const MAX_UNTRACKED_IN_DIFF = 50;

const SHA_RE = /^[0-9a-f]{7,64}$/;

const GIT_ERROR_STATUS: Record<string, number> = {
  git_missing: 501,
  not_found: 404,
  not_a_repo: 404,
  path_traversal: 400,
  git_error: 422,
};

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

/* ------------------------------------------------------------------------ */
/*  Script building                                                         */
/* ------------------------------------------------------------------------ */

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Workspace root as a shell word, expanded by the remote shell. */
function targetRootWord(target: TargetSpec): string {
  const rel =
    target.kind === "role"
      ? `fleet/roles/${target.roleSlug}`
      : `fleet/identities/${target.identityKey}/workspace`;
  return `"$HOME"/${shellEscape(rel)}`;
}

/**
 * Shared prelude: error helper, read-only git wrapper, cd into the root.
 * `fail <class>` prints an X record and exits 0 so the class reaches us
 * through stdout rather than an exit code.
 */
function prelude(target: TargetSpec): string {
  return [
    `fail() { printf '\\036X\\037%s' "$1"; exit 0; }`,
    `g() { GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 git -c core.fsmonitor=false -c core.untrackedCache=false -c color.ui=false -c core.quotePath=false "$@"; }`,
    `command -v git >/dev/null 2>&1 || fail git_missing`,
    `cd ${targetRootWord(target)} 2>/dev/null || fail not_found`,
    `root=$(pwd -P)`,
  ].join("\n");
}

/** cd into a repo under the root, refusing anything that resolves outside it. */
function enterRepo(repoPath: string): string {
  const word = repoPath === "" ? "." : shellEscape(repoPath);
  return [
    `cd ${word} 2>/dev/null || fail not_found`,
    `here=$(pwd -P)`,
    `case "$here" in "$root"|"$root"/*) ;; *) fail path_traversal ;; esac`,
    `[ -e .git ] || fail not_a_repo`,
  ].join("\n");
}

/** %H US %P US %an US %ct US %D US %s — parsed by parseCommitFields. */
const COMMIT_FORMAT = "%H%x1f%P%x1f%an%x1f%ct%x1f%D%x1f%s";

export function buildReposScript(target: TargetSpec): string {
  return [
    prelude(target),
    // Prune heavy dirs and stop descending at each .git (dir or worktree file).
    `find . -maxdepth 4 \\( -name node_modules -o -name .venv -o -name venv \\) -prune -o -name .git -prune -print 2>/dev/null | head -n ${MAX_REPOS + 1} | {`,
    `n=0`,
    `while IFS= read -r d; do`,
    `  n=$((n+1)); [ "$n" -gt ${MAX_REPOS} ] && { printf '\\036T\\037'; break; }`,
    `  r=\${d%/.git}`,
    `  printf '\\036R\\037%s\\037' "$r"`,
    `  ( cd "$r" && g status --porcelain=v2 --branch -z 2>/dev/null; printf '\\037%s\\037' "$?"; g log -1 --format='${COMMIT_FORMAT}' 2>/dev/null )`,
    `done; }`,
  ].join("\n");
}

export function buildRepoScript(target: TargetSpec, repoPath: string): string {
  return [
    prelude(target),
    enterRepo(repoPath),
    `printf '\\036S\\037'; g status --porcelain=v2 --branch -z 2>/dev/null; printf '\\037%s' "$?"`,
    `printf '\\036L\\037'; g log -z -n 50 --format='${COMMIT_FORMAT}' 2>/dev/null`,
    `printf '\\036Z\\037'; g stash list -z --format='%gd%x1f%ct%x1f%gs' 2>/dev/null`,
    `printf '\\036M\\037'; g remote -v 2>/dev/null`,
  ].join("\n");
}

/** `diff` (not `kind` — that field already names the workspace target). */
export type DiffRequest = { diff: "working" } | { diff: "commit"; sha: string };

export function buildDiffScript(
  target: TargetSpec,
  repoPath: string,
  req: DiffRequest,
): string {
  const diffFlags = "--no-color --no-ext-diff --no-textconv -M";
  const body =
    req.diff === "commit"
      ? [
          `g rev-parse -q --verify '${req.sha}^{commit}' >/dev/null 2>&1 || fail not_found`,
          `if g rev-parse -q --verify '${req.sha}^1' >/dev/null 2>&1; then base='${req.sha}^1'; else base=$(g hash-object -t tree /dev/null); fi`,
          `g diff ${diffFlags} "$base" '${req.sha}' --`,
        ]
      : [
          `base=$(g rev-parse -q --verify HEAD 2>/dev/null) || base=$(g hash-object -t tree /dev/null)`,
          `g diff ${diffFlags} "$base" --`,
          `g ls-files -z --others --exclude-standard 2>/dev/null | tr '\\0' '\\n' | head -n ${MAX_UNTRACKED_IN_DIFF} | while IFS= read -r f; do g diff ${diffFlags} --no-index -- /dev/null "$f"; done`,
        ];
  return [
    prelude(target),
    enterRepo(repoPath),
    // Cap on the host so a giant diff never crosses the wire.
    `{ ${body.join("\n")}\n} 2>/dev/null | head -c ${MAX_PATCH_BYTES + 1}`,
  ].join("\n");
}

/* ------------------------------------------------------------------------ */
/*  Exec                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Run a script on an exec channel and buffer stdout up to maxBytes (output
 * past the cap is dropped and `truncated` is set). Exit codes are ignored —
 * the scripts report failures through X records.
 */
function execScript(
  client: SSHClientType,
  script: string,
  maxBytes: number,
): Promise<{ stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    client.exec(`sh -c ${shellEscape(script)}`, (err, stream) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      stream.on("data", (buf: Buffer) => {
        if (size >= maxBytes) {
          truncated = true;
          return;
        }
        const room = maxBytes - size;
        if (buf.length > room) {
          truncated = true;
          buf = buf.subarray(0, room);
        }
        chunks.push(buf);
        size += buf.length;
      });
      stream.stderr.on("data", () => {
        /* drained; scripts silence stderr */
      });
      stream.on("close", () => {
        resolve({ stdout: Buffer.concat(chunks).toString("utf-8"), truncated });
      });
      stream.on("error", reject);
    });
  });
}

/* ------------------------------------------------------------------------ */
/*  Shared request chain                                                    */
/* ------------------------------------------------------------------------ */

function errorStatus(err: unknown): number {
  if (err instanceof GitScriptError) return GIT_ERROR_STATUS[err.message] ?? 502;
  return classifyErrorToStatus(err);
}

function errorClass(err: unknown): string {
  if (err instanceof GitScriptError) {
    return err.message in GIT_ERROR_STATUS ? err.message : "git_error";
  }
  return classifyErrorToClass(err);
}

/**
 * Validate the common body fields, authorise, then run `script(target)` on
 * the host and hand stdout to `respond`. Every handler goes through here.
 */
async function handleGitRequest(
  req: Request,
  res: Response,
  operation: string,
  opts: {
    /** Extra body validation; return an error class to reject with 400. */
    validate?: (body: Record<string, unknown>) => string | null;
    maxBytes: number;
    script: (target: TargetSpec, body: Record<string, unknown>) => string;
    respond: (out: { stdout: string; truncated: boolean }, body: Record<string, unknown>) => unknown;
  },
): Promise<void> {
  const body = req.body as Record<string, unknown> | null;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (typeof body.hostId !== "number" && typeof body.hostId !== "string") ||
    (body.repoPath !== undefined && typeof body.repoPath !== "string")
  ) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const extra = opts.validate?.(body);
  if (extra) {
    res.status(400).json({ error: extra });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;

  const targetResult = extractTarget(body);
  if (targetResult.ok === false) {
    res.status(400).json({ error: targetResult.error });
    return;
  }
  const target = targetResult.target;

  const repoPath = typeof body.repoPath === "string" ? body.repoPath : "";
  try {
    validateRelativePath(repoPath);
    if (repoPath.startsWith("/") || repoPath.includes("\0")) throw new Error("path_traversal");
  } catch {
    res.status(400).json({ error: "path_traversal" });
    return;
  }

  const hostId = Number(body.hostId);
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    res.status(404).json({ error: "unknown_host" });
    return;
  }
  const accessInfo = await permissionManager.canAccessHost(userId, hostId, "read");
  if (!accessInfo.hasAccess) {
    res.status(403).json({ error: "permission_denied" });
    return;
  }

  const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GIT_OP_TIMEOUT_MS);
  try {
    const out = await getHostSemaphore(hostId).run(() =>
      withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        (client) =>
          runWithAbort(ctrl.signal, () =>
            execScript(client, opts.script(target, body), opts.maxBytes),
          ),
      ),
    );
    res.json(opts.respond(out, body));
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorClass(err) });
    sshLogger.warn(`workspace-git ${operation} error`, {
      operation: `workspace_git_${operation}`,
      errorName: err instanceof Error ? err.name : "unknown",
      userId,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------ */
/*  Router                                                                  */
/* ------------------------------------------------------------------------ */

const workspaceGitRoutes = express.Router();

workspaceGitRoutes.post(
  "/repos",
  express.json({ limit: "64kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleGitRequest(req, res, "repos", {
      maxBytes: MAX_META_BYTES,
      script: (target) => buildReposScript(target),
      respond: ({ stdout, truncated }) => {
        const list = parseRepoList(stdout);
        return { repos: list.repos, truncated: list.truncated || truncated };
      },
    }),
);

workspaceGitRoutes.post(
  "/repo",
  express.json({ limit: "64kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleGitRequest(req, res, "repo", {
      maxBytes: MAX_META_BYTES,
      script: (target, body) => buildRepoScript(target, String(body.repoPath ?? "")),
      respond: ({ stdout }, body) => parseRepoDetail(stdout, String(body.repoPath ?? "")),
    }),
);

workspaceGitRoutes.post(
  "/diff",
  express.json({ limit: "64kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleGitRequest(req, res, "diff", {
      validate: (body) => {
        if (body.diff === "commit") {
          return typeof body.sha === "string" && SHA_RE.test(body.sha) ? null : "invalid_body";
        }
        return body.diff === undefined || body.diff === "working" ? null : "invalid_body";
      },
      maxBytes: MAX_PATCH_BYTES + 1,
      script: (target, body) =>
        buildDiffScript(
          target,
          String(body.repoPath ?? ""),
          body.diff === "commit" ? { diff: "commit", sha: String(body.sha) } : { diff: "working" },
        ),
      respond: ({ stdout }) => {
        // An X record can only come before any diff output.
        if (stdout.startsWith("\x1eX\x1f")) {
          throw new GitScriptError(stdout.slice(3).trim() || "git_error");
        }
        const truncated = Buffer.byteLength(stdout) > MAX_PATCH_BYTES;
        return {
          patch: truncated ? Buffer.from(stdout).subarray(0, MAX_PATCH_BYTES).toString("utf-8") : stdout,
          truncated,
        };
      },
    }),
);

export default workspaceGitRoutes;
