/**
 * sharing-host.ts — read one machine's sharing state (people, agents, roles,
 * projects with their `users:` lists) and write `users:` lists back.
 *
 * Remote reads are one exec per folder kind: every agent's and every role's
 * frontmatter comes back base64'd in a single round-trip, the same framing as
 * listProjects. A sidebar app or a scheduled task is read on its own (its
 * JSON card). Writes re-read each file just before rewriting its `users:`
 * list, so a field changed meanwhile by anything else is kept.
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
  getLocalAppsRoot,
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
  getLocalScheduledAgentsRoot,
  IDENTITY_SLUG_RE,
  APP_SLUG_RE,
  listProjects,
  readIdentityFile,
  readProjectFile,
  readRoleFileByName,
  writeIdentityFile,
  writeProjectFile,
  writeRoleFileByName,
  writeMarkdownFileAtomic,
} from "../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../database/routes/identity-birth-orchestrator.js";
import type {
  ShareAgent,
  ShareApp,
  ShareHostState,
  ShareKind,
  ShareRole,
  ShareTask,
  ShareWrite,
} from "./sharing-plan.js";

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

type CardKind = "app" | "task";

const CARD_MISSING = "__SKYNET_SHARE_CARD_MISSING__";

/** `$HOME/fleet/...` path of a sidebar app's or a scheduled task's JSON card. */
function cardPath(kind: CardKind, slug: string): string {
  return kind === "app" ? `$HOME/fleet/apps/${slug}/app.json` : `$HOME/fleet/scheduled-agents/${slug}/scheduled-agent.json`;
}

function cardSlugOk(kind: CardKind, slug: string): boolean {
  return kind === "app" ? APP_SLUG_RE.test(slug) : IDENTITY_SLUG_RE.test(slug);
}

/** The card's text, or null when there is none. */
async function readCard(conn: SSHClientType | null, kind: CardKind, slug: string): Promise<string | null> {
  if (!cardSlugOk(kind, slug)) throw new Error(`invalid ${kind} slug`);
  if (conn === null) {
    const root = kind === "app" ? getLocalAppsRoot() : getLocalScheduledAgentsRoot();
    try {
      return await fs.readFile(path.join(root, slug, kind === "app" ? "app.json" : "scheduled-agent.json"), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  // Slug is regex-checked above, so it is safe inside double quotes.
  const file = cardPath(kind, slug);
  const out = await execWithTimeout(conn, `if [ -f "${file}" ]; then cat "${file}"; else printf '${CARD_MISSING}'; fi`);
  return out === CARD_MISSING ? null : out;
}

/** The card as an object; null when missing; throws when it isn't a JSON object. */
async function readCardObject(
  conn: SSHClientType | null,
  kind: CardKind,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const text = await readCard(conn, kind, slug);
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${kind} card is not a JSON object`);
  return parsed as Record<string, unknown>;
}

const stringList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((u) => typeof u === "string") ? (v as string[]) : null;

export function appFromCard(slug: string, card: Record<string, unknown>): ShareApp {
  const title = typeof card.title === "string" ? card.title.trim() : "";
  return { name: slug, label: title || slug, users: stringList(card.users) };
}

export function taskFromCard(slug: string, card: Record<string, unknown>): ShareTask {
  const name = typeof card.name === "string" ? card.name.trim() : "";
  return {
    name: slug,
    label: name || slug,
    roles: Array.isArray(card.roles) ? card.roles.filter((r): r is string => typeof r === "string" && r.length > 0) : [],
    users: stringList(card.users),
  };
}

export async function readShareHostState(
  conn: SSHClientType | null,
  people: string[],
  /** Roles kept on every machine, or "all" when that list couldn't be read. */
  instanceWideRoles: ReadonlySet<string> | "all",
  /** The thing being looked at. An app needs nothing else from the machine. */
  target?: { kind: ShareKind; slug: string },
): Promise<ShareHostState> {
  const apps: ShareApp[] = [];
  const tasks: ShareTask[] = [];
  if (target?.kind === "app") {
    const card = await readCardObject(conn, "app", target.slug);
    if (card) apps.push(appFromCard(target.slug, card));
    return { people, agents: [], roles: [], projects: [], apps, tasks };
  }
  if (target?.kind === "task") {
    const card = await readCardObject(conn, "task", target.slug);
    if (card) tasks.push(taskFromCard(target.slug, card));
  }
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
    apps,
    tasks,
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
  } else if (w.kind === "project") {
    const { markdown } = await readProjectFile(conn, w.slug);
    const next = withUsersBlock(markdown, w.users);
    if (next !== markdown) await writeProjectFile(conn, w.slug, next);
  } else {
    // Every other field of the card is kept as it is on disk now.
    const card = await readCardObject(conn, w.kind, w.slug);
    if (card === null) throw new Error(`${w.kind} ${w.slug} not found`);
    const prev = Array.isArray(card.users) ? (card.users as unknown[]) : [];
    if (prev.length === w.users.length && w.users.every((u, i) => prev[i] === u)) return;
    await writeMarkdownFileAtomic(conn, cardPath(w.kind, w.slug), JSON.stringify({ ...card, users: w.users }, null, 2) + "\n");
  }
}
