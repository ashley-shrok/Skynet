/**
 * role-description.ts — a role's one-line description, kept as the
 * `description:` key in the role file's frontmatter (same idea as a skill's
 * description).
 *
 * Absent key ⇒ "" (no fallback to the `## Role` section text). Values are
 * collapsed to a single line, so a hand-written multi-line value still
 * renders as one line.
 */

import { parseDocument } from "yaml";

// A leading byte-order mark is tolerated, as the roles window and the agent
// startup hook do.
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/;

/** Collapse all whitespace runs (newlines included) to single spaces. */
export function normalizeRoleDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The frontmatter `description:` of a role file, or "" when absent/unusable. */
export function readRoleDescriptionFromMarkdown(markdown: string): string {
  const m = FRONTMATTER_RE.exec(markdown);
  if (!m) return "";
  // Tolerant parse: a YAML error on some other line doesn't hide a cleanly
  // parsed description.
  const parsed = parseDocument(m[1]).toJS() as unknown;
  if (parsed === null || typeof parsed !== "object") return "";
  const value = (parsed as Record<string, unknown>).description;
  return typeof value === "string" ? normalizeRoleDescription(value) : "";
}

/**
 * Whether the role file marks the role borrowable (`borrowable: true` in its
 * frontmatter): any agent on the host may borrow it for a task without
 * taking it on. Only a YAML boolean true counts; anything else is false.
 */
export function readRoleBorrowableFromMarkdown(markdown: string): boolean {
  const m = FRONTMATTER_RE.exec(markdown);
  if (!m) return false;
  const parsed = parseDocument(m[1]).toJS() as unknown;
  if (parsed === null || typeof parsed !== "object") return false;
  return (parsed as Record<string, unknown>).borrowable === true;
}
