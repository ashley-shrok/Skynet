#!/usr/bin/env node
/**
 * Vendor foliate-js (MIT, https://github.com/johnfactotum/foliate-js) — the
 * ebook engine behind the Foliate reader — into src/ui/vendor/foliate-js/.
 * It isn't published on npm, so a pinned commit is copied in.
 *
 * Usage: git clone https://github.com/johnfactotum/foliate-js /tmp/foliate-js
 *        git -C /tmp/foliate-js checkout <commit>
 *        node scripts/vendor-foliate-js.mjs /tmp/foliate-js <commit>
 *
 * Copied: the book formats Skynet opens (EPUB, MOBI/AZW3, FB2, CBZ), the
 * paginator / fixed-layout renderers, search and their small helpers.
 * Skipped: the PDF backend (13 MB of bundled pdf.js — PDFs open in Skynet's
 * own PDF viewer; pdf.js is replaced by a stub), the demo UI, OPDS,
 * dictionaries, tests and build tooling.
 *
 * Security: book content is rendered in same-origin frames that allow
 * scripts, so the reader page MUST run under a strict CSP — see
 * ebook-reader.html and its nginx location block.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "LICENSE",
  "view.js",
  "epub.js",
  "epubcfi.js",
  "mobi.js",
  "fb2.js",
  "comic-book.js",
  "paginator.js",
  "fixed-layout.js",
  "footnotes.js",
  "progress.js",
  "overlayer.js",
  "text-walker.js",
  "search.js",
  "tts.js",
  "vendor/zip.js",
  "vendor/fflate.js",
];

const PDF_STUB = `// Skynet: foliate-js's PDF backend is not vendored (it bundles 13 MB of
// pdf.js); PDFs open in Skynet's own PDF viewer instead.
export const makePDF = async () => {
  throw new Error("PDF files open in the PDF viewer")
}
`;

const [source, commit] = process.argv.slice(2);
if (!source || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  console.error("usage: vendor-foliate-js.mjs <foliate-js checkout> <40-char commit>");
  process.exit(1);
}
const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== commit) {
  console.error(`checkout is at ${head}, expected ${commit}`);
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "src/ui/vendor/foliate-js");
await rm(dest, { recursive: true, force: true });
for (const file of FILES) {
  await mkdir(path.dirname(path.join(dest, file)), { recursive: true });
  await copyFile(path.join(source, file), path.join(dest, file));
}
await writeFile(path.join(dest, "pdf.js"), PDF_STUB);
await writeFile(
  path.join(dest, "VERSION"),
  `https://github.com/johnfactotum/foliate-js\ncommit ${commit}\nvendored by scripts/vendor-foliate-js.mjs (pdf.js replaced by a stub)\n`,
);
console.log(`vendored foliate-js ${commit.slice(0, 12)} → ${path.relative(root, dest)}`);
