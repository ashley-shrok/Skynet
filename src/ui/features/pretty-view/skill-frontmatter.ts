// SKILL.md frontmatter helpers for the Skills modal's invocation toggles:
// "User-invoked only" = `disable-model-invocation: true`, "Agent-invoked
// only" = `user-invocable: false` (both harness-recognized). Line-based on
// purpose — only those keys are read or rewritten; every other frontmatter
// line (and the body) is left byte-for-byte untouched, so we don't
// round-trip through a YAML serializer that would reformat the author's
// hand-written frontmatter.

const MODEL_KEY = "disable-model-invocation";
const USER_KEY = "user-invocable";

// Captures the value without a trailing `# comment`, so a hand-written
// `user-invocable: false  # helper` reads the way a YAML parser (and the
// server's skill list) reads it.
function keyLine(key: string): RegExp {
  return new RegExp(`^${key}\\s*:\\s*([^#]*?)\\s*(?:#.*)?$`);
}

type Split = { bom: string; eol: string; fm: string[] | null; body: string };

// Tolerant the way the server's migrations are: a leading byte-order mark is
// kept aside, `---` lines may carry trailing spaces, and the line ending is
// the first line's (a body pasted from elsewhere may use the other kind).
function split(content: string): Split {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = content.slice(bom.length);
  const nl = text.indexOf("\n");
  const eol = nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n";
  const lines: Array<{ text: string; end: number }> = [];
  const re = /([^\r\n]*)(\r?\n|$)/g;
  for (let m = re.exec(text); m && m[0] !== ""; m = re.exec(text)) {
    lines.push({ text: m[1], end: re.lastIndex });
  }
  const isFence = (l: string) => l.trimEnd() === "---";
  if (lines.length === 0 || !isFence(lines[0].text)) return { bom, eol, fm: null, body: text };
  const close = lines.findIndex((l, i) => i > 0 && isFence(l.text));
  if (close === -1) return { bom, eol, fm: null, body: text };
  return {
    bom,
    eol,
    fm: lines.slice(1, close).map((l) => l.text),
    body: text.slice(lines[close].end),
  };
}

function hasBool(content: string, key: string, value: boolean): boolean {
  const { fm } = split(content);
  if (!fm) return false;
  const re = keyLine(key);
  for (const line of fm) {
    const m = re.exec(line);
    if (m) return new RegExp(`^["']?${value}["']?$`, "i").test(m[1]);
  }
  return false;
}

/** Drop `key` from the frontmatter, then append `key: value` when value is non-null. */
function setKey(content: string, key: string, value: boolean | null): string {
  const { bom, eol, fm, body } = split(content);
  const re = keyLine(key);
  const kept = (fm ?? []).filter((line) => !re.test(line));
  if (value !== null) kept.push(`${key}: ${value}`);
  if (!fm && kept.length === 0) return content;
  return bom + ["---", ...kept, "---"].join(eol) + eol + body;
}

export function isModelInvocationDisabled(content: string): boolean {
  return hasBool(content, MODEL_KEY, true);
}

export function isUserInvocationDisabled(content: string): boolean {
  return hasBool(content, USER_KEY, false);
}

/**
 * "User-invoked only". Turning it on also clears "Agent-invoked only" —
 * with both set nobody could invoke the skill.
 */
export function setModelInvocationDisabled(content: string, disabled: boolean): string {
  const next = setKey(content, MODEL_KEY, disabled ? true : null);
  return disabled && isUserInvocationDisabled(next) ? setKey(next, USER_KEY, null) : next;
}

/**
 * "Agent-invoked only". Turning it on also clears "User-invoked only" —
 * with both set nobody could invoke the skill.
 */
export function setUserInvocationDisabled(content: string, disabled: boolean): string {
  const next = setKey(content, USER_KEY, disabled ? false : null);
  return disabled && isModelInvocationDisabled(next) ? setKey(next, MODEL_KEY, null) : next;
}

// `name:` — the folder name IS a skill's (or role skill's) name; a `name:` in its
// main file must agree with it. Mirrors src/backend/utils/folder-item-name.ts.
const NAME_LINE = /^name\s*:\s*(.*?)\s*$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

/** The frontmatter `name:` value, or null when there is none (or it is empty). */
export function frontmatterName(content: string): string | null {
  const { fm } = split(content);
  if (!fm) return null;
  for (const line of fm) {
    const m = NAME_LINE.exec(line);
    if (m) return unquote(m[1]) || null;
  }
  return null;
}
