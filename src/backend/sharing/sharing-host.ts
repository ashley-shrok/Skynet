/**
 * sharing-host.ts — read one machine's sharing state (people, agents, roles,
 * projects with their `users:` lists) and write `users:` lists back.
 *
 * Remote reads are one exec per folder kind: every agent's and every role's
 * frontmatter comes back base64'd in a single round-trip, the same framing as
 * listProjects. Writes re-read each file just before rewriting its `users:`
 * block, so a field changed meanwhile by anything else is kept.
 */
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";
import {
  IDENTITY_KEY_RE,
  applyProjectUsersBlock,
  execWithTimeout,
  extractCosmeticsFromFrontmatter,
  extractRolesFromMarkdown,
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
  listProjects,
  readIdentityFile,
  readProjectFile,
  readRoleFileByName,
  writeIdentityFile,
  writeProjectFile,
  writeRoleFileByName,
} from "../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../database/routes/identity-birth-orchestrator.js";
import type { ShareAgent, ShareHostState, ShareRole, ShareWrite } from "./sharing-plan.js";

const HEADER_RE = /^===ITEM:(.*)===$/;

/** Frontmatter only — agent files carry long bodies the plan never needs. */
export function batchFrontmatterCmd(dir: "identities" | "roles"): string {
  return (
    `find "$HOME/fleet/${dir}" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | ` +
    `while IFS= read -r s; do printf '===ITEM:%s===\\n' "$s"; ` +
    `f="$HOME/fleet/${dir}/$s/$s.md"; ` +
    `[ -f "$f" ] && awk 'NR==1 && $0 !~ /---/ {exit} {print} NR>1 && /^---/ {exit}' "$f" 2>/dev/null | base64 | tr -d '\\n'; ` +
    `printf '\\n'; done; true`
  );
}

/** name → frontmatter text, for names passing `nameRe`. First occurrence wins. */
export function parseBatchOutput(stdout: string, nameRe: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const lines = stdout.split("\n").map((l) => l.replace(/\r$/, ""));
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    const next = lines[i + 1];
    const hasPayload = next !== undefined && !HEADER_RE.test(next);
    if (hasPayload) i++;
    if (!nameRe.test(name) || out.has(name)) continue;
    let text = "";
    if (hasPayload && next.trim().length > 0) {
      try {
        text = Buffer.from(next.trim(), "base64").toString("utf-8");
      } catch {
        text = "";
      }
    }
    out.set(name, text);
  }
  return out;
}

async function readLocalFolder(root: string, nameRe: RegExp): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !nameRe.test(e.name)) continue;
    try {
      out.set(e.name, await fs.readFile(path.join(root, e.name, `${e.name}.md`), "utf-8"));
    } catch {
      out.set(e.name, "");
    }
  }
  return out;
}

async function readFolder(
  conn: SSHClientType | null,
  dir: "identities" | "roles",
  nameRe: RegExp,
): Promise<Map<string, string>> {
  if (conn === null) {
    return readLocalFolder(dir === "identities" ? getLocalIdentitiesRoot() : getLocalRolesRoot(), nameRe);
  }
  return parseBatchOutput(await execWithTimeout(conn, batchFrontmatterCmd(dir)), nameRe);
}

const listOrNull = (u: string[] | undefined): string[] | null =>
  Array.isArray(u) && u.length > 0 ? u : null;

export function agentFromMarkdown(name: string, markdown: string): ShareAgent {
  const cos = extractCosmeticsFromFrontmatter(markdown);
  return {
    name,
    label: cos.displayName?.trim() || name,
    roles: extractRolesFromMarkdown(markdown),
    project: cos.project ?? null,
    users: listOrNull(cos.users),
  };
}

export function roleFromMarkdown(name: string, markdown: string, instanceWide: boolean): ShareRole {
  const cos = extractCosmeticsFromFrontmatter(markdown);
  return {
    name,
    label: cos.displayName?.trim() || name,
    users: listOrNull(cos.users),
    instanceWide,
  };
}

export async function readShareHostState(
  conn: SSHClientType | null,
  people: string[],
  /** Roles kept on every machine, or "all" when that list couldn't be read. */
  instanceWideRoles: ReadonlySet<string> | "all",
): Promise<ShareHostState> {
  const identities = await readFolder(conn, "identities", IDENTITY_KEY_RE);
  const roleFiles = await readFolder(conn, "roles", ROLE_NAME_PATTERN);
  const projects = await listProjects(conn);
  return {
    people,
    agents: [...identities].map(([n, md]) => agentFromMarkdown(n, md)),
    roles: [...roleFiles].map(([n, md]) => roleFromMarkdown(n, md, instanceWideRoles === "all" || instanceWideRoles.has(n))),
    projects: projects.map((p) => ({
      slug: p.slug,
      label: p.displayName,
      parent: p.parent,
      users: listOrNull(p.users ?? undefined),
    })),
  };
}

/**
 * `applyProjectUsersBlock`, giving a file with no frontmatter one first and
 * dropping a leading BOM (the readers' frontmatter match can't see past one).
 * Throws on frontmatter that opens and never closes — a write would change
 * nothing while reporting success. Always ends in a newline (remote reads
 * come back trimmed).
 */
export function withUsersBlock(markdown: string, users: readonly string[]): string {
  const text = markdown.replace(/^\uFEFF/, "");
  const base = /^---\r?\n/.test(text) ? text : `---\n---\n${text}`;
  if (!/^---\r?\n(?:[^\n]*\n)*?---(?:\r?\n|$)/.test(base)) {
    throw new Error("frontmatter is not closed");
  }
  const next = applyProjectUsersBlock(base, users);
  return next.endsWith("\n") ? next : `${next}\n`;
}

/** Rewrite one thing's `users:` list. No write when nothing changes. */
export async function writeShareList(conn: SSHClientType | null, w: ShareWrite): Promise<void> {
  if (w.users.length === 0) throw new Error("refusing to write an empty users list");
  if (w.kind === "agent") {
    const { markdown } = await readIdentityFile(conn, w.slug);
    if (markdown.trim() === "") throw new Error(`agent ${w.slug} not found`);
    const next = withUsersBlock(markdown, w.users);
    if (next !== markdown) await writeIdentityFile(conn, w.slug, next);
  } else if (w.kind === "role") {
    const { markdown } = await readRoleFileByName(conn, w.slug, { strict: true });
    if (markdown.trim() === "") throw new Error(`role ${w.slug} not found`);
    const next = withUsersBlock(markdown, w.users);
    if (next !== markdown) await writeRoleFileByName(conn, w.slug, next);
  } else {
    const { markdown } = await readProjectFile(conn, w.slug);
    const next = withUsersBlock(markdown, w.users);
    if (next !== markdown) await writeProjectFile(conn, w.slug, next);
  }
}
