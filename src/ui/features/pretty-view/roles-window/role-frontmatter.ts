// Role-file frontmatter helpers for the roles window. Every per-field save
// (description, colour, voice, picture) merges one key into the frontmatter
// of the server-echoed role file and writes the whole file back, so the
// rest of the file — and any keys we don't own — survive untouched.
//
// Frontmatter is YAML. These helpers handle the shapes role files actually
// use: one-line scalars, plus values that continue on indented lines (block
// scalars such as `description: >-`, lists such as `users:` + `- name`).
// A key's indented continuation lines belong to it: replacing or clearing
// an owned key takes them along; other keys keep theirs.

// The block may be empty (`---\n---\n`).
const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

/** Keys the roles window writes. Anything else in the frontmatter is kept. */
const OWNED_KEYS = ["displayName", "title", "description", "colorHue", "voice", "avatar"] as const;
type OwnedKey = (typeof OWNED_KEYS)[number];

export type RoleFrontmatterPatch = Partial<Record<OwnedKey, string | number>>;

interface FmEntry {
  key: string | null; // null: a line that isn't a key (comment, blank)
  lines: string[]; // the key line plus its indented continuation lines
}

function splitFrontmatter(markdown: string): { entries: FmEntry[]; rest: string; found: boolean } {
  const match = markdown.match(FM_RE);
  if (!match) return { entries: [], rest: markdown, found: false };
  const entries: FmEntry[] = [];
  for (const line of match[1] === undefined ? [] : match[1].split(/\r?\n/)) {
    // Indented lines, and a list's "- item" lines, continue the key above.
    const continuation = (/^\s/.test(line) && line.trim() !== "") || /^-(\s|$)/.test(line);
    const last = entries[entries.length - 1];
    if (continuation && last?.key) {
      last.lines.push(line);
      continue;
    }
    const keyMatch = line.match(KEY_RE);
    entries.push({ key: keyMatch ? keyMatch[1] : null, lines: [line] });
  }
  return { entries, rest: markdown.slice(match[0].length), found: true };
}

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
  const { entries, rest, found } = splitFrontmatter(currentBody);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.key) {
      seen.add(entry.key);
      if (cleared.has(entry.key)) continue;
      if ((OWNED_KEYS as readonly string[]).includes(entry.key)) {
        const val = patch[entry.key as OwnedKey];
        if (val !== undefined && val !== "") {
          out.push(`${entry.key}: ${yamlScalar(val)}`);
          continue;
        }
      }
    }
    out.push(...entry.lines);
  }
  for (const key of OWNED_KEYS) {
    if (seen.has(key) || cleared.has(key)) continue;
    const val = patch[key];
    if (val !== undefined && val !== "") out.push(`${key}: ${yamlScalar(val)}`);
  }
  // Without a frontmatter block the whole input is body.
  const body = found ? rest : currentBody;
  return `---\n${out.join("\n")}${out.length ? "\n" : ""}---\n` + body;
}

// Words YAML would read as something other than a string.
const YAML_NON_STRING = /^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?|0x[0-9a-fA-F]+|\.inf|\.nan)$/i;

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return `'${String(value)}'`;
  if (value === "" || YAML_NON_STRING.test(value)) return JSON.stringify(value);
  if (/[:#\-[\]{}&*!|>'"%@`,?]/.test(value) || /\s/.test(value)) return JSON.stringify(value);
  return value;
}

/**
 * A scalar from the frontmatter, unquoted, as one line; "" when absent.
 * Handles quoted values, block scalars (`>`, `|`, with chomping marks) and
 * plain values that continue on indented lines.
 */
export function readRoleFrontmatterValue(markdown: string, key: string): string {
  const { entries } = splitFrontmatter(markdown);
  const entry = entries.find((e) => e.key === key);
  if (!entry) return "";
  const raw = (entry.lines[0].match(KEY_RE)?.[2] ?? "").trim();
  const more = entry.lines.slice(1).map((l) => l.trim());
  if (/^[>|][+-]?\d*$/.test(raw)) {
    // Block scalar: folded (>) joins with spaces, literal (|) keeps lines —
    // shown as one line either way.
    return more.join(raw.startsWith("|") ? "\n" : " ").replace(/\s+/g, " ").trim();
  }
  if (raw.startsWith('"')) {
    const whole = [raw, ...more].join(" ");
    try {
      return String(JSON.parse(whole));
    } catch {
      return whole.replace(/^"|"$/g, "");
    }
  }
  if (raw.startsWith("'")) {
    return [raw, ...more].join(" ").replace(/^'|'$/g, "").replace(/''/g, "'");
  }
  return [raw, ...more].join(" ").replace(/\s+/g, " ").trim();
}

/** What the in-place editor accepts when typing. Longer stored text is kept. */
export const ROLE_DESCRIPTION_MAX = 160;

/** One line: runs of whitespace (including newlines) collapse to a space. */
export function cleanRoleDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
