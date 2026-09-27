// Strip a leading YAML frontmatter block from a markdown string so
// ReactMarkdown preview surfaces (RoleFileTab, IdentityFileTab,
// ProjectFileTab) don't render the raw `---\nkey: value\n---` at the top
// of the file body. Regex matches the same shape used by RoleModal's
// mergeCosmeticsIntoMarkdown so any file we can WRITE frontmatter to, we
// can also strip it from.
//
// Only the LEADING block is stripped — a thematic-break `---` mid-file
// (rare in these docs but legal markdown) is untouched.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "");
}
