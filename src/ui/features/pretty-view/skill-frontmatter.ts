// SKILL.md frontmatter helpers for the Skills modal's invocation toggles:
// "User-invoked only" = `disable-model-invocation: true`, "Agent-invoked
// only" = `user-invocable: false` (both harness-recognized). Line-based on
// purpose — only those keys are read or rewritten; every other frontmatter
// line (and the body) is left byte-for-byte untouched, so we don't
// round-trip through a YAML serializer that would reformat the author's
// hand-written frontmatter.

const MODEL_KEY = "disable-model-invocation";
const USER_KEY = "user-invocable";

function keyLine(key: string): RegExp {
  return new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`);
}

type Split = { eol: string; fm: string[] | null; body: string };

function split(content: string): Split {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(eol);
  if (lines[0] !== "---") return { eol, fm: null, body: content };
  const close = lines.indexOf("---", 1);
  if (close === -1) return { eol, fm: null, body: content };
  return {
    eol,
    fm: lines.slice(1, close),
    body: lines.slice(close + 1).join(eol),
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
  const { eol, fm, body } = split(content);
  const re = keyLine(key);
  const kept = (fm ?? []).filter((line) => !re.test(line));
  if (value !== null) kept.push(`${key}: ${value}`);
  if (!fm && kept.length === 0) return content;
  return ["---", ...kept, "---"].join(eol) + eol + (fm ? body : content);
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
