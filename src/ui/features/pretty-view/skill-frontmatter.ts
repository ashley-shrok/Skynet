// SKILL.md frontmatter helpers for the Skills modal's
// `disable-model-invocation` toggle. Line-based on purpose — only the one
// key is read or rewritten; every other frontmatter line (and the body) is
// left byte-for-byte untouched, so we don't round-trip through a YAML
// serializer that would reformat the author's hand-written frontmatter.

const KEY = "disable-model-invocation";
const KEY_LINE = new RegExp(`^${KEY}\\s*:\\s*(.*?)\\s*$`);

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

export function isModelInvocationDisabled(content: string): boolean {
  const { fm } = split(content);
  if (!fm) return false;
  for (const line of fm) {
    const m = KEY_LINE.exec(line);
    if (m) return /^["']?true["']?$/i.test(m[1]);
  }
  return false;
}

export function setModelInvocationDisabled(content: string, disabled: boolean): string {
  const { eol, fm, body } = split(content);
  const kept = (fm ?? []).filter((line) => !KEY_LINE.test(line));
  if (disabled) kept.push(`${KEY}: true`);
  if (!fm && kept.length === 0) return content;
  return ["---", ...kept, "---"].join(eol) + eol + (fm ? body : content);
}
