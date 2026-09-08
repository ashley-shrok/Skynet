/**
 * Phase 40 Plan 40-02 (D-02): Frontend copy of the "eligible file" whitelist.
 *
 * MIRROR: byte-identical copy in src/backend/utils/editable-file-whitelist.ts
 *   for the whitelist data (EDITABLE_EXTENSIONS + EDITABLE_BASENAMES +
 *   classifyByExtension + TAILNET_URL_RE_CLIENT). Update those in lockstep.
 *   The fleet has no shared code directory in the ship pipeline
 *   (`src/backend/*` and `src/ui/*` are separate build roots); duplication
 *   is the established pattern (see `src/types/` and `src/ui/api/`).
 *
 *   INTENTIONAL FRONTEND-ONLY: `stripTrailingPunct` — the extract-side URL
 *   normalizer added in rev-3 2026-08-14 (code-review H2). Backend has no
 *   use for it (it validates URLs the client has already extracted); adding
 *   it there would be dead code. The regex + whitelist proper stay mirrored.
 *
 * Contract (D-02):
 *   Wholesale-accept files whose extension is in EDITABLE_EXTENSIONS, OR whose
 *   filename is in EDITABLE_BASENAMES. This is the FIRST-PASS check; extensionless
 *   text files (e.g. some agents' output) fall through to the byte-sniff fallback
 *   which runs SERVER-SIDE (backend proxy from Plan 40-01) — the frontend never
 *   re-implements byte-sniffing; it reads `isTextByBytes` from the proxy response.
 *
 * The whitelist is intentionally a STARTER SET (per shape lock: "grows over time
 * as misses are noticed"). Do NOT over-engineer: no admin API, no hot-reload,
 * no config-file loader. A plain module-level const Set is correct here.
 */

/** File extensions that the affordance recognizes wholesale. Grows over time. */
export const EDITABLE_EXTENSIONS = new Set<string>([
  // Markdown & prose
  "md", "mdx", "markdown", "txt", "rst", "adoc",
  // Config
  "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties",
  // Source code (fleet-relevant)
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp", "cs", "m", "mm",
  "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql",
  // Web
  "html", "htm", "css", "scss", "sass", "less",
  "vue", "svelte", "astro",
  // Data
  "csv", "tsv", "xml", "log",
  // Diff / patch
  "patch", "diff",
]);

/** Extensionless basenames that are conventionally text. */
export const EDITABLE_BASENAMES = new Set<string>([
  "Dockerfile", "Makefile", "Rakefile", "Gemfile", "Procfile",
  ".gitignore", ".dockerignore", ".editorconfig", ".gitattributes",
  ".env", ".envrc", ".nvmrc", ".node-version", ".python-version",
  "README", "LICENSE", "CHANGELOG", "AUTHORS", "CONTRIBUTORS", "COPYING",
  "NOTICE", "TODO", "COMMIT_EDITMSG",
]);

/**
 * Returns true iff the extension is in EDITABLE_EXTENSIONS OR the filename is
 * in EDITABLE_BASENAMES. Extension is expected to be lowercased and already
 * stripped of the leading dot (caller's responsibility — mirrors how the
 * backend route derives `extension` from `filename.split(".").pop()`).
 */
export function classifyByExtension(
  extension: string | null,
  filename: string,
): boolean {
  if (extension && EDITABLE_EXTENSIONS.has(extension)) return true;
  if (EDITABLE_BASENAMES.has(filename)) return true;
  return false;
}

/**
 * D-01 URL shape: matches the id-skill's `python3 -m http.server` +
 * tailnet-IP-bind pattern (`http://100.x.y.z:PORT/filename`). The character
 * class encodes the 100.64.0.0/10 Tailscale CGNAT range at parse time.
 *
 * Regex terminator `[^\s)]+` handles bare URLs AND markdown-link internals
 * like `[text](url)` — matching stops at the first whitespace or closing
 * paren, so a markdown link's closing `)` does not get folded into the URL.
 * Trailing prose punctuation (`.,;:!?`) is trimmed by `stripTrailingPunct`
 * (see below) rather than in the regex itself — see H2 fix note.
 *
 * The /g flag is INTENTIONAL: consumers scan message bodies for MULTIPLE
 * matches per message (an agent may serve several files in one reply). When
 * using `.exec()` in a loop, reset `.lastIndex` between runs; when using
 * `.match()`, no reset is needed (each call is stateless).
 *
 * ⚠️ Do NOT call `.test()` on this global regex — it mutates `lastIndex` and
 * will silently return stale results on subsequent calls. Use `.match()` (or
 * `.matchAll()`) which is stateless per call.
 *
 * NOTE: this regex is ONLY unanchored/global on the client (message-scan
 * duty); the backend uses an anchored `^...$` variant for URL validation.
 */
export const TAILNET_URL_RE_CLIENT =
  /http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^\s)]+/g;

/**
 * Phase 75 D-01 URL shape: <skynet-domain>[:port]/file/<hostname>/<abs-path>
 * Example: https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md
 *
 * Grammar (locked in Phase 75 D-01):
 *   - scheme:      https:// only (agents on Skynet always run on the HTTPS
 *                  deployment; the backend rejects http:// too)
 *   - domain:      any DNS-legal hostname + optional :port
 *                  ([a-zA-Z0-9.-]+(?::\d{1,5})?)
 *   - literal:     /file/
 *   - hostname:    [a-zA-Z0-9._-]+ — matches hosts.name for the fleet's
 *                  simple-name convention; the backend route in Plan 75-01
 *                  re-validates with the same character class
 *   - literal:     /
 *   - abs-path:    [^\s)?#]+ — stops at whitespace, closing paren, query
 *                  start, or fragment start (same terminator style as
 *                  TAILNET_URL_RE_CLIENT above)
 *
 * Trailing prose punctuation (`.,;:!?`) is trimmed downstream by
 * stripTrailingPunct (H2 fix) — the regex itself is intentionally greedy
 * on `.` so `notes.md` survives; the punctuation trim happens post-extract.
 *
 * The /g flag is INTENTIONAL: consumers scan message bodies for MULTIPLE
 * matches per message. When using `.match()`, no state reset is needed
 * (each call is stateless).
 *
 * ⚠️ Same /g gotcha as TAILNET_URL_RE_CLIENT (L89-91 above): NEVER call
 * `.test()` on this regex — it mutates `.lastIndex` and returns alternating
 * true/false. For dispatch decisions (which fetch helper to call), use a
 * fresh non-global regex or `url.startsWith(...)`-shape guards. See
 * `use-editable-file-eligibility.ts` and `EditableFileModal.tsx` for the
 * dispatch pattern.
 *
 * MIRROR-RULE bookkeeping (Phase 40 D-02): the backend twin at
 * src/backend/utils/editable-file-whitelist.ts holds the whitelist DATA
 * (EDITABLE_EXTENSIONS + EDITABLE_BASENAMES + classifyByExtension) in
 * lockstep, but does NOT re-export this regex — the backend route
 * (pretty-view-fetch-host-file.ts from Plan 75-01) does its own hostname
 * + path validation with `/^[a-zA-Z0-9._-]+$/` etc. Same reason
 * TAILNET_URL_RE_CLIENT ships client-only today: the server uses its own
 * anchored variant inside the fetch route. The backend twin's docblock
 * carries a note referencing this export to preserve the mirror-rule
 * paper trail.
 */
export const SKYNET_FILE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g;

/**
 * Strip trailing prose punctuation from an extracted URL (rev-3 2026-08-14
 * code-review H2). GFM autolink literals trim `.,;:!?` from the end of a URL
 * when rendering an `<a>` (so `see http://100.64.0.1:8000/notes.md.` renders
 * as an anchor with `href="http://100.64.0.1:8000/notes.md"` and a literal
 * `.` outside the anchor). Our extraction regex greedily consumed the
 * trailing punctuation, so the eligibility Set held `notes.md.` while
 * ChatMessage's `<a>` override was checking for `notes.md` — every prose-end
 * URL silently lost its edit affordance. This normalizer aligns both sides.
 *
 * Applied at extraction time BEFORE inserting the URL into the eligibility
 * Set, so all downstream comparisons see the trimmed form.
 */
export function stripTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}
