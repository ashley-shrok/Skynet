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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

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
