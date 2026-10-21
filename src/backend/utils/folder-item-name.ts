/**
 * folder-item-name.ts — the `name:` frontmatter key of a folder-backed item's
 * main file (a skill's or role skill's SKILL.md). The folder name
 * IS the item's name; a `name:` in the main file must agree with it.
 *
 * Line-based on purpose (same posture as the UI's skill-frontmatter helpers):
 * only the `name:` line is read or rewritten, every other frontmatter line and
 * the body stay byte-for-byte untouched.
 */

import type { Response } from "express";

const NAME_LINE_RE = /^name\s*:\s*(.*?)\s*$/;

function frontmatterLines(content: string): { eol: string; lines: string[]; close: number } | null {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(eol);
  if (lines[0] !== "---") return null;
  const close = lines.indexOf("---", 1);
  if (close === -1) return null;
  return { eol, lines, close };
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  // Unquoted YAML scalar — a ` #` starts a comment.
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

/**
 * The frontmatter `name:` value, or null when there is no frontmatter, no
 * `name:` key, or an empty one (the harness then falls back to the folder).
 */
export function frontmatterName(content: string): string | null {
  const fm = frontmatterLines(content);
  if (!fm) return null;
  for (let i = 1; i < fm.close; i++) {
    const m = NAME_LINE_RE.exec(fm.lines[i]);
    if (m) return unquote(m[1]) || null;
  }
  return null;
}

/**
 * Rewrite an existing `name:` line to `name`. Content without a `name:` key is
 * returned unchanged — the folder name already governs it.
 */
export function withFrontmatterName(content: string, name: string): string {
  const fm = frontmatterLines(content);
  if (!fm) return content;
  for (let i = 1; i < fm.close; i++) {
    if (NAME_LINE_RE.test(fm.lines[i])) {
      const next = [...fm.lines];
      next[i] = `name: ${name}`;
      return next.join(fm.eol);
    }
  }
  return content;
}

/** True when `content` names something other than `folder` in its frontmatter. */
export function nameMismatchesFolder(content: string, folder: string): boolean {
  const name = frontmatterName(content);
  return name !== null && name !== folder;
}

/**
 * True when a write would newly put the item's main file out of step with its
 * folder: `next` names something other than `folder`, and that name isn't
 * already what's on disk (`current`). A file that already disagreed before
 * this feature existed stays saveable as long as its name isn't changed.
 */
export function introducesNameMismatch(next: string, current: string, folder: string): boolean {
  const name = frontmatterName(next);
  return name !== null && name !== folder && name !== frontmatterName(current);
}

/** 400 body for a main-file write whose `name:` disagrees with its folder. */
export function nameMismatchBody(kind: "skill", folder: string, name: string | null) {
  return {
    error: `The name in this file ("${name ?? ""}") must match the ${kind}'s folder ("${folder}"). Use Rename… to rename the ${kind}.`,
    code: "name_mismatch",
    folder,
    name,
  };
}

/**
 * Refuse (400 name_mismatch) a main-file write that would newly put its
 * `name:` out of step with the folder. `readCurrent` fetches what's on disk
 * now ("" when missing) and only runs when `next` disagrees with the folder.
 * Returns true when it has responded.
 */
export async function refuseIfNameMismatch(
  res: Response,
  kind: "skill",
  folder: string,
  next: string,
  readCurrent: () => Promise<string>,
): Promise<boolean> {
  if (!nameMismatchesFolder(next, folder)) return false;
  if (!introducesNameMismatch(next, await readCurrent(), folder)) return false;
  res.status(400).json(nameMismatchBody(kind, folder, frontmatterName(next)));
  return true;
}

/**
 * Phase 113 D-06 + D-07: compose the seed SKILL.md body for a brand-new skill.
 *
 * Shape (LF line endings) — frontmatter block + prettified-slug H1 so
 * MDXEditor's Lexical parser has at least one markdown node to render; with
 * pure-frontmatter-plus-blank the contenteditable rendered empty and the
 * silent-failure detector swapped the editor into the code-editor fallback
 * for every freshly-created skill (field repro 2026-10-03):
 *
 *   ---\n
 *   name: <slug>\n
 *   description: "<yaml-safe-desc>"\n
 *   ---\n
 *   \n
 *   # <PrettifiedSlug>\n
 *
 * Prettify = `-`/`_` → space, first char uppercased (same deslugify shape as
 * the scheduled-agents `task:` prefix). Users can rename the heading to the
 * display name they actually want in the editor.
 *
 * YAML-safety (D-07): unconditional double-quote wrap; escape embedded `\` and
 * `"`. ORDER MATTERS — escape `\` FIRST, then `"`. Reversing the order would
 * mangle `\"` (the `"`-escape's output is `\"`, which the subsequent
 * `\`-escape would then turn into `\\"`). See RESEARCH.md § Common Pitfalls #7.
 *
 * The `\n`/`\r` reject in the POST /skill handler is belt-and-suspenders — no
 * caller should reach this helper with multi-line content, but if they do the
 * quote wrap still produces valid YAML (embedded LF in a double-quoted YAML
 * string is invalid on its own but our upstream rejection catches it first).
 */
export function composeSkillMdSeed(slug: string, description: string): string {
  const yamlSafeDesc = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const spaced = slug.replace(/[-_]/g, " ");
  const heading = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return `---\nname: ${slug}\ndescription: "${yamlSafeDesc}"\n---\n\n# ${heading}\n`;
}
