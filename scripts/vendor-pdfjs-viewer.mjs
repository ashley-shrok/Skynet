#!/usr/bin/env node
/**
 * Vendor Mozilla's prebuilt pdf.js viewer (the full Firefox PDF viewer:
 * toolbar, thumbnails, search, forms, annotation editing) into
 * public/pdfjs/v<version>/. npm's pdfjs-dist ships only the library and
 * viewer components, not this viewer, so it comes from the GitHub release.
 *
 * Usage: node scripts/vendor-pdfjs-viewer.mjs <version> <sha256-of-legacy-zip>
 *   e.g. node scripts/vendor-pdfjs-viewer.mjs 6.4.299 <sha256>
 *
 * Then update PDFJS_VERSION in src/ui/features/pretty-view/file-viewers/
 * pdf/pdfjs-paths.ts and delete the old public/pdfjs/v<old>/ directory.
 * The directory is versioned so nginx can cache it immutably.
 *
 * Uses the "legacy" build: the standard build needs very recent browser
 * features (e.g. Map.prototype.getOrInsertComputed) that current Safari
 * and slightly older Chromium/Firefox lack.
 *
 * Skipped from the release: source maps, the debugger, the sample PDF.
 */

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const [version, expectedSha] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !expectedSha) {
  console.error("usage: vendor-pdfjs-viewer.mjs <version> <sha256-of-zip>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "public", "pdfjs", `v${version}`);
const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-legacy-dist.zip`;

const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);
const zipBytes = Buffer.from(await res.arrayBuffer());
const sha = createHash("sha256").update(zipBytes).digest("hex");
if (sha !== expectedSha) {
  throw new Error(`sha256 mismatch for ${url}\n  expected ${expectedSha}\n  got      ${sha}`);
}

const SKIP = [/\.map$/, /^web\/debugger\./, /^web\/compressed\.tracemonkey-pldi-09\.pdf$/];

await rm(dest, { recursive: true, force: true });
const zip = await JSZip.loadAsync(zipBytes);
let count = 0;
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir || SKIP.some((re) => re.test(name))) continue;
  const out = path.join(dest, name);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await entry.async("nodebuffer"));
  count++;
}
console.log(`pdf.js ${version}: ${count} files → ${path.relative(root, dest)} (zip sha256 ${sha})`);
