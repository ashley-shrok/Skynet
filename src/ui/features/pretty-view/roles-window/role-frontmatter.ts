// Role-file frontmatter helpers for the roles window. Every per-field save
// (description, colour, voice, picture) merges one key into the frontmatter
// of the server-echoed role file and writes the whole file back, so the
// rest of the file — and any keys we don't own — survive untouched.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Keys the roles window writes. Anything else in the frontmatter is kept. */
const OWNED_KEYS = ["displayName", "title", "description", "colorHue", "voice", "avatar"] as const;
type OwnedKey = (typeof OWNED_KEYS)[number];

export type RoleFrontmatterPatch = Partial<Record<OwnedKey, string | number>>;

/**
 * Upsert the keys in `patch` (an empty string is ignored) and delete the keys
 * in `clearedKeys`. Keys already in the file keep their position.
 */
export function mergeRoleFrontmatter(
  currentBody: string,
  patch: RoleFrontmatterPatch,
  clearedKeys?: ReadonlySet<string>,
): string {
  const cleared = clearedKeys ?? new Set<string>();
  const match = currentBody.match(FM_RE);
  const existingLines = match ? match[1].split(/\r?\n/) : [];
  const restBody = match ? currentBody.slice(match[0].length) : currentBody;

  const newLines: string[] = [];
  const seen = new Set<string>();
  for (const line of existingLines) {
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      seen.add(key);
      if (cleared.has(key)) continue;
      if ((OWNED_KEYS as readonly string[]).includes(key)) {
        const val = patch[key as OwnedKey];
        if (val !== undefined && val !== "") {
          newLines.push(`${key}: ${yamlScalar(val)}`);
          continue;
        }
      }
    }
    newLines.push(line);
  }
  for (const key of OWNED_KEYS) {
    if (seen.has(key) || cleared.has(key)) continue;
    const val = patch[key];
    if (val !== undefined && val !== "") newLines.push(`${key}: ${yamlScalar(val)}`);
  }
  return `---\n${newLines.join("\n")}\n---\n` + restBody;
}

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return `'${String(value)}'`;
  if (/[:#\-[\]{}&*!|>'"%@`]/.test(value) || /\s/.test(value)) return JSON.stringify(value);
  return value;
}

/** A single-line scalar from the frontmatter, unquoted; "" when absent. */
export function readRoleFrontmatterValue(markdown: string, key: string): string {
  const match = markdown.match(FM_RE);
  if (!match) return "";
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m || m[1] !== key) continue;
    const raw = m[2].trim();
    if (raw.startsWith('"')) {
      try {
        return String(JSON.parse(raw));
      } catch {
        return raw.slice(1, -1);
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw;
  }
  return "";
}

/** One line, at most this long — the description is a one-liner. */
export const ROLE_DESCRIPTION_MAX = 160;

export function cleanRoleDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ROLE_DESCRIPTION_MAX);
}
