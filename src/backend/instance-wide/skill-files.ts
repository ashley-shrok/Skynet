/**
 * instance-wide/skill-files.ts — the skills editor's endpoints, served from the
 * master copy instead of a host. The skills editor routes hand off here when a
 * request carries hostId=0 (the "instance-wide" section of the skills window),
 * so the editor UI talks one contract for both.
 *
 * Reads are open to every signed-in user; writes are admin-only and land in the
 * master copy, which the engine then pushes to every machine.
 */
import path from "path";
import type { Request, Response } from "express";
import yaml from "js-yaml";
import type { AuthenticatedRequest } from "../../types/index.js";
import { getInstanceWide } from "./production.js";
import { isSafeRelPath, isValidItemName } from "./model.js";
import { callerIsAdmin } from "./admin.js";

export const INSTANCE_HOST_ID = 0;

const MAX_CONTENT_BYTES = 2_000_000;

/** True when the request targets the instance-wide section (hostId=0). */
export function isInstanceScope(req: Request): boolean {
  const raw =
    (req.query as Record<string, unknown>).hostId ??
    ((req.body ?? {}) as Record<string, unknown>).hostId;
  return raw === 0 || raw === "0";
}

function engineOr503(res: Response) {
  const engine = getInstanceWide();
  if (!engine) res.status(503).json({ error: "instance-wide sync is not running" });
  return engine;
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  if (await callerIsAdmin((req as AuthenticatedRequest).userId)) return true;
  res.status(403).json({ error: "instance-wide skills can only be changed by an admin" });
  return false;
}

function isTextBuf(buf: Buffer): boolean {
  const window = buf.subarray(0, Math.min(8192, buf.length));
  for (const b of window) {
    if (b === 0 || b <= 0x08 || (b >= 0x0e && b <= 0x1f)) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(window);
    return true;
  } catch {
    return false;
  }
}

function args(req: Request): Record<string, unknown> {
  return { ...(req.query as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) };
}

async function skillOr404(res: Response, skill: unknown): Promise<string | null> {
  const engine = getInstanceWide();
  if (!isValidItemName(skill)) {
    res.status(400).json({ error: "invalid skill name" });
    return null;
  }
  if (!engine || !(await engine.isInstanceWide("skill", skill))) {
    res.status(404).json({ error: "skill not found" });
    return null;
  }
  return skill;
}

// GET /skills
export async function listInstanceSkills(_req: Request, res: Response): Promise<void> {
  const engine = engineOr503(res);
  if (!engine) return;
  const skills = [];
  for (const name of await engine.listNames("skill")) {
    let description: string | undefined;
    try {
      const text = (await engine.readMasterFile("skill", name, "SKILL.md")).toString("utf-8");
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const fm = m ? (yaml.load(m[1]) as Record<string, unknown> | null) : null;
      if (fm && typeof fm.description === "string") {
        description = fm.description.replace(/\s+/g, " ").trim() || undefined;
      }
    } catch {
      description = undefined;
    }
    skills.push(description ? { name, description } : { name });
  }
  res.json({ skills });
}

// GET /files
export async function listInstanceSkillFiles(req: Request, res: Response): Promise<void> {
  const skill = await skillOr404(res, args(req).skill);
  if (!skill) return;
  const files = await getInstanceWide()!.masterStore.listFiles("skill", skill);
  res.json({ files: files.map((p) => ({ path: p })) });
}

// POST /read
export async function readInstanceSkillFile(req: Request, res: Response): Promise<void> {
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const store = getInstanceWide()!.masterStore;
  const st = await store.statFile("skill", skill, a.path);
  if (!st) {
    res.json({ content: "", mtime: 0, size: 0, isText: true });
    return;
  }
  const buf = await store.readFile("skill", skill, a.path);
  const isText = isTextBuf(buf);
  res.json({ content: isText ? buf.toString("utf-8") : "", mtime: st.mtime, size: st.size, isText });
}

// PUT /write
export async function writeInstanceSkillFile(req: Request, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  if (typeof a.content !== "string" || Buffer.byteLength(a.content, "utf-8") > MAX_CONTENT_BYTES) {
    res.status(400).json({ error: "content must be a string ≤2MB" });
    return;
  }
  const rel = a.path;
  const content = a.content;
  const engine = getInstanceWide()!;
  const store = engine.masterStore;
  if (typeof a.expectedMtime === "number") {
    const st = await store.statFile("skill", skill, rel);
    const current = st?.mtime ?? 0;
    if (current !== a.expectedMtime) {
      const currentContent = st ? (await store.readFile("skill", skill, rel)).toString("utf-8") : "";
      res.status(409).json({ error: "mtime mismatch", currentMtime: current, currentContent });
      return;
    }
  }
  await engine.editMaster("skill", skill, (s) => s.writeFile("skill", skill, rel, Buffer.from(content, "utf-8")));
  res.json({ mtime: (await store.statFile("skill", skill, rel))?.mtime ?? 0 });
}

// PUT /write-binary
export async function writeInstanceSkillBinary(req: Request, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "body must be non-empty application/octet-stream" });
    return;
  }
  const rel = a.path;
  const bytes = req.body;
  await getInstanceWide()!.editMaster("skill", skill, (s) => s.writeFile("skill", skill, rel, bytes));
  res.json({ ok: true });
}

// POST /create  (new file)
export async function createInstanceSkillFile(req: Request, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const rel = a.path;
  const engine = getInstanceWide()!;
  if (await engine.masterStore.statFile("skill", skill, rel)) {
    res.status(409).json({ error: "file exists" });
    return;
  }
  await engine.editMaster("skill", skill, (s) => s.writeFile("skill", skill, rel, Buffer.alloc(0)));
  res.json({ path: rel, mtime: (await engine.masterStore.statFile("skill", skill, rel))?.mtime ?? 0 });
}

// POST /skill  (new instance-wide skill)
export async function createInstanceSkill(req: Request, res: Response, seed: (slug: string, description: string) => string): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const engine = engineOr503(res);
  if (!engine) return;
  const a = args(req);
  if (!isValidItemName(a.skill)) {
    res.status(400).json({ error: "invalid skill name" });
    return;
  }
  if (typeof a.description !== "string" || a.description.trim() === "" || /[\r\n]/.test(a.description)) {
    res.status(400).json({ error: "description is required and must be single-line" });
    return;
  }
  const slug = a.skill;
  if (await engine.isInstanceWide("skill", slug)) {
    res.status(409).json({ error: "skill exists" });
    return;
  }
  await engine.createItem("skill", slug, new Map([["SKILL.md", Buffer.from(seed(slug, a.description), "utf-8")]]));
  res.json({ slug, mtime: (await engine.masterStore.statFile("skill", slug, "SKILL.md"))?.mtime ?? 0 });
}

// DELETE /file
export async function deleteInstanceSkillFile(req: Request, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  if (a.path === "SKILL.md") {
    res.status(400).json({ error: "cannot delete SKILL.md" });
    return;
  }
  const rel = a.path;
  await getInstanceWide()!.editMaster("skill", skill, (s) => s.deleteFile("skill", skill, rel));
  res.json({ ok: true });
}

// DELETE /skill  (remove the instance-wide skill everywhere)
export async function deleteInstanceSkill(req: Request, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const skill = await skillOr404(res, args(req).skill);
  if (!skill) return;
  const result = await getInstanceWide()!.removeItem("skill", skill);
  res.json({ ok: true, ...result });
}

const ALWAYS_DOWNLOAD = new Set([".html", ".htm", ".js", ".mjs", ".svg"]);

// GET /download
export async function downloadInstanceSkillFile(req: Request, res: Response): Promise<void> {
  const a = args(req);
  const skill = await skillOr404(res, a.skill);
  if (!skill) return;
  if (!isSafeRelPath(a.path)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const store = getInstanceWide()!.masterStore;
  if (!(await store.statFile("skill", skill, a.path))) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const abs = store.absolutePath("skill", skill, a.path);
  const ext = path.extname(a.path).toLowerCase();
  if (a.inline !== "1" || ALWAYS_DOWNLOAD.has(ext)) res.attachment(path.basename(a.path));
  res.sendFile(abs, { dotfiles: "allow" });
}
