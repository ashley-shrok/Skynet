// Pure (no React) so the backend search can tidy slash commands the same way
// the conversation does.

// Prettify slash-command triplets that Claude Code emits in JSONL user turns.
//
// A slash-command invocation ("/id tina", "/help", "/exit") lands in the wire
// content as a RUN of one or more of these XML-ish tags, in any order:
//   <command-message>...</command-message>
//   <command-name>/id</command-name>
//   <command-args>tina</command-args>
// react-markdown intentionally does NOT parse raw HTML (rehype-raw is disabled
// per patch #47 for XSS safety), so these tags render as escaped tag text and
// clutter user bubbles. This module preprocesses the content string, replacing
// each contiguous run with a compact sentinel marker `⟨cmd:/id tina⟩`
// (U+27E8 / U+27E9 mathematical angle brackets — unlikely to appear in prose)
// that a downstream `p` component override then splits back out into
// <CommandChip> pills.
//
// The backend session-file-parser.ts stays faithful to the wire format — this
// is a pure presentational transform on the render side.

// Matches a RUN of one or more consecutive command tags, with optional
// whitespace BETWEEN them (not after — trailing whitespace stays in the
// surrounding prose so "⟨cmd:...⟩ then ⟨cmd:...⟩" keeps the separator).
//
// Each individual tag is one of the three closed pairs. Written out
// explicitly rather than with a backreference so the pattern can safely
// repeat inside `(?:...)*` without capture-group collisions. `[^<]*`
// inside each tag is safe because these tag values are always plain text
// (no nested tags).
const SINGLE_CMD_TAG_ANON =
  "(?:<command-message>[^<]*<\\/command-message>" +
  "|<command-name>[^<]*<\\/command-name>" +
  "|<command-args>[^<]*<\\/command-args>)";
const COMMAND_BLOCK_RE = new RegExp(
  `${SINGLE_CMD_TAG_ANON}(?:\\s*${SINGLE_CMD_TAG_ANON})*`,
  "g",
);

// Individual field extractors used within a matched block. Non-global so
// callers get a fresh match without lastIndex bookkeeping.
const NAME_RE = /<command-name>([^<]*)<\/command-name>/;
const ARGS_RE = /<command-args>([^<]*)<\/command-args>/;

/**
 * Scan `text` for runs of `<command-message>` / `<command-name>` /
 * `<command-args>` tags and collapse each run to a compact `⟨cmd:...⟩`
 * marker containing the trimmed command name plus (space + trimmed args)
 * if args are non-empty. Runs without a `<command-name>` tag are left
 * unchanged (malformed) so we never emit a marker without a command name.
 */
export function preprocessCommandTriplets(text: string): string {
  return text.replace(COMMAND_BLOCK_RE, (block) => {
    const nameMatch = block.match(NAME_RE);
    if (!nameMatch) return block; // malformed: no command-name, pass through
    const name = nameMatch[1].trim();
    if (!name) return block; // empty name → also treat as malformed
    const argsMatch = block.match(ARGS_RE);
    const args = argsMatch ? argsMatch[1].trim() : "";
    return args ? `⟨cmd:${name} ${args}⟩` : `⟨cmd:${name}⟩`;
  });
}

