#!/usr/bin/env node
/**
 * Vendor draw.io's viewer library (viewer-static.min.js, Apache-2.0, from
 * https://github.com/jgraph/drawio) into public/drawio/v<version>/. It isn't
 * on npm; the viewer page (public/drawio/viewer.html) loads it in a
 * sandboxed, CSP-locked frame.
 *
 * Usage: git clone --filter=blob:none --depth 1 --branch v<version> \
 *          https://github.com/jgraph/drawio /tmp/drawio
 *        node scripts/vendor-drawio-viewer.mjs /tmp/drawio <version>
 * Then update DRAWIO_VERSION in
 * src/ui/features/pretty-view/file-viewers/diagram/drawio-paths.ts and
 * delete the old public/drawio/v<old>/ (versioned → immutable caching).
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [source, version] = process.argv.slice(2);
if (!source || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: vendor-drawio-viewer.mjs <drawio checkout> <version>");
  process.exit(1);
}
const tag = execFileSync("git", ["-C", source, "describe", "--tags", "--exact-match"], { encoding: "utf8" }).trim();
if (tag !== `v${version}`) {
  console.error(`checkout is at ${tag}, expected v${version}`);
  process.exit(1);
}
execFileSync("git", ["-C", source, "-c", "gc.auto=0", "checkout", "HEAD", "--", "src/main/webapp/js/viewer-static.min.js", "LICENSE"]);
const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "public/drawio", `v${version}`);
await mkdir(dest, { recursive: true });
await copyFile(path.join(source, "src/main/webapp/js/viewer-static.min.js"), path.join(dest, "viewer-static.min.js"));
await copyFile(path.join(source, "LICENSE"), path.join(dest, "LICENSE"));
await writeFile(path.join(dest, "VERSION"), `draw.io v${version} (${commit})\nhttps://github.com/jgraph/drawio\n`);
console.log(`vendored draw.io viewer v${version} → ${path.relative(root, dest)}`);
