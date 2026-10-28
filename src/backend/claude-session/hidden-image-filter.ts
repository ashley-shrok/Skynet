/**
 * Host-side filter that blanks the picture data of tool-result images before
 * a session file's lines cross the network.
 *
 * When an agent looks at an image (Read of a PNG, a browser screenshot), the
 * JSONL records the whole picture as base64 — ~1 MB per look, twice over
 * (the user tool_result line and Claude Code's api-request-blob copy). The
 * parser never shows these (tool-result images are agent-internal), yet an
 * image-heavy agent's recent window is almost all of them: Tin on thenasty
 * opened with a 66 MB window, 65 MB of it these pictures.
 *
 * The filter only touches lines that carry a `"tool_use_id":"` — every
 * tool-result image does, and a user-pasted image line doesn't, so pasted
 * pictures arrive intact. Within those lines it empties each long base64
 * `"data"` / `"base64"` string value. Lines are never added or removed, and
 * every other field is untouched, so line numbers, parser classification and
 * the server's per-line state machines see the same file they always did.
 *
 * Perl does the work where present (every Linux fleet host has it — Debian's
 * perl-base is essential, Fedora images carry it): ~0.1 s for Tin's 115 MB
 * file, where sed's regex engine takes 3–8 s on these megabyte-long lines.
 * sed is the fallback for a host without perl. LC_ALL=C keeps both
 * byte-oriented. Both scripts are single-quoted here and contain no single
 * quote, so the filter drops into a pipeline with no quoting of its own.
 * sed: `-E` and `{n,}` intervals work in GNU, BSD and busybox sed; `#` is the
 * s-command delimiter because `/` appears in the base64 class and `|` is ERE
 * alternation.
 */

/** Shortest base64 run treated as picture data. Real images are far longer;
 *  ids, hashes and short tokens are far shorter. */
export const HIDDEN_IMAGE_MIN_BASE64 = 512;

const PERL_SCRIPT =
  `if (index($_, q{"tool_use_id":"}) >= 0) { s/"(data|base64)":"[A-Za-z0-9+\\/=]{${HIDDEN_IMAGE_MIN_BASE64},}"/"$1":""/g }`;
const SED_SCRIPT =
  `/"tool_use_id":"/s#"(data|base64)":"[A-Za-z0-9+/=]{${HIDDEN_IMAGE_MIN_BASE64},}"#"\\1":""#g`;

/** Reads stdin, writes the filtered lines to stdout (perl, else sed). */
export const HIDDEN_IMAGE_FILTER =
  `{ if command -v perl >/dev/null 2>&1; then LC_ALL=C perl -pe '${PERL_SCRIPT}'; ` +
  `else LC_ALL=C sed -E '${SED_SCRIPT}'; fi; }`;

/** The sed fallback alone (tests run it to prove it matches perl). */
export const HIDDEN_IMAGE_FILTER_SED = `LC_ALL=C sed -E '${SED_SCRIPT}'`;

/**
 * The same transformation in JS, for local (conn === null) reads and tests.
 * Must stay byte-for-byte equivalent to the perl and sed scripts.
 */
const DATA_RE = new RegExp(`"(data|base64)":"[A-Za-z0-9+/=]{${HIDDEN_IMAGE_MIN_BASE64},}"`, "g");
export function blankHiddenImages(line: string): string {
  if (!line.includes('"tool_use_id":"')) return line;
  return line.replace(DATA_RE, '"$1":""');
}
