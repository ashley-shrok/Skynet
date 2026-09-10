/**
 * Phase 40 Plan 40-01 (D-02): Backend copy of the "eligible file" whitelist.
 *
 * MIRROR: the whitelist DATA (EDITABLE_EXTENSIONS + EDITABLE_BASENAMES +
 *   classifyByExtension) is a byte-identical copy in
 *   src/ui/features/pretty-view/editable-file-whitelist.ts — update both
 *   files in lockstep. The fleet has no shared code directory in the ship
 *   pipeline (`src/backend/*` and `src/ui/*` are separate build roots);
 *   duplication is the established pattern (see `src/types/` and `src/ui/api/`).
 *
 *   The frontend twin also exports `TAILNET_URL_RE_CLIENT` (message-scan
 *   duty) and `stripTrailingPunct` (URL normalizer for the eligibility hook).
 *   Backend has no use for either — it validates URLs the client has already
 *   extracted, using its own anchored `TAILNET_URL_RE` inside the fetch route.
 *
 *   PHASE 75 D-01 MIRROR-RULE UPDATE (2026-09-06): the frontend twin has
 *   gained a second URL regex `SKYNET_FILE_URL_RE_CLIENT` (sibling to
 *   `TAILNET_URL_RE_CLIENT`) matching the new file-URL shape
 *   `https://<domain>[:port]/file/<hostname>/<abs-path>`. This backend twin
 *   does NOT re-export that regex — the backend route
 *   `src/backend/database/routes/pretty-view-fetch-host-file.ts` (shipped
 *   in Plan 75-01) does its own hostname + path validation with
 *   `/^[a-zA-Z0-9._-]+$/` and explicit prefix/traversal checks. Same
 *   rationale as `TAILNET_URL_RE_CLIENT` being client-only. The whitelist
 *   DATA (EDITABLE_EXTENSIONS + EDITABLE_BASENAMES + classifyByExtension)
 *   remains mirrored in lockstep as before.
 *
 *   PHASE 103 D-29 MIRROR-RULE UPDATE (2026-09-10): the frontend twin has
 *   gained a THIRD URL regex `SKYNET_SERVE_URL_RE_CLIENT` (sibling to
 *   `TAILNET_URL_RE_CLIENT` and `SKYNET_FILE_URL_RE_CLIENT`) matching the
 *   serve URL shape `https://<hostname>-<port>.serve.term.<domain>[/path]`.
 *   This backend twin does NOT re-export that regex — the backend validates
 *   serve URLs via the subdomain-dispatch middleware's own parse logic per
 *   D-11 (split on last dash of leftmost DNS label; right side must be all
 *   digits). Same rationale as `TAILNET_URL_RE_CLIENT` and
 *   `SKYNET_FILE_URL_RE_CLIENT` being client-only. The whitelist DATA
 *   (`EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`, `classifyByExtension`)
 *   remains mirrored in lockstep as before — Phase 103 does NOT change the
 *   whitelist data itself.
 *
 * Contract (D-02):
 *   Wholesale-accept files whose extension is in EDITABLE_EXTENSIONS, OR whose
 *   filename is in EDITABLE_BASENAMES. This is the FIRST-PASS check; extensionless
 *   text files (e.g. some agents' output) fall through to the byte-sniff fallback
 *   in editable-file-byte-sniff.ts.
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
