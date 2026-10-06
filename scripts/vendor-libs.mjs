/**
 * Libraries the file viewers load on demand as separate, unmodified files,
 * served from our own origin under <base>/vendor/<group>/ — never from a
 * CDN. This Vite plugin serves them from node_modules in dev and emits them
 * into the build.
 *
 *   3d/    Online3DViewer's decoders (STEP/IGES via OpenCascade, Rhino .3dm,
 *          IFC, Draco glTF) and lighting map. Upstream fetches these from
 *          cdn.jsdelivr.net; scripts/patch-online-3d-viewer.cjs repoints it.
 *   heif/  libheif (LGPL-3.0) for HEIC photos, kept as its own file.
 *   excalidraw/  Excalidraw's fonts (its default is esm.sh). A key ending in
 *          "/" maps a whole directory.
 *
 * Paths keep the CDN's `<package>@<version>/` layout, so a version bump
 * changes the URL (safe to cache immutably; see the /vendor/3d/ nginx block).
 * The versions must match what Online3DViewer asks for; the build fails if
 * the installed package differs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_MODULES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules");

/** `<pkg>@<version>/<path as requested>` → file inside the installed package. */
const VENDOR_3D_FILES = {
  "occt-import-js@0.0.22/dist/occt-import-js-worker.js": "dist/occt-import-js-worker.js",
  "occt-import-js@0.0.22/dist/occt-import-js.js": "dist/occt-import-js.js",
  "occt-import-js@0.0.22/dist/occt-import-js.wasm": "dist/occt-import-js.wasm",
  "rhino3dm@8.17.0/rhino3dm.min.js": "rhino3dm.min.js",
  "rhino3dm@8.17.0/rhino3dm.wasm": "rhino3dm.wasm",
  "web-ifc@0.0.68/web-ifc-api-iife.js": "web-ifc-api-iife.js",
  "web-ifc@0.0.68/web-ifc.wasm": "web-ifc.wasm",
  // jsDelivr minifies on the fly; npm ships only the unminified build.
  "draco3d@1.5.7/draco_decoder_nodejs.min.js": "draco_decoder_nodejs.js",
  "draco3d@1.5.7/draco_decoder.wasm": "draco_decoder.wasm",
  // Environment map that lights glTF's physically-based materials (without
  // one they render near-black). Humus, CC-BY 3.0 — see THIRD_PARTY_NOTICES.
  ...Object.fromEntries(
    ["posx", "negx", "posy", "negy", "posz", "negz"].map((face) => [
      `online-3d-viewer@0.18.0/envmap/${face}.jpg`,
      `website/assets/envmaps/fishermans_bastion/${face}.jpg`,
    ]),
  ),
};

const VENDOR_HEIF_FILES = {
  // ES module with the WebAssembly inlined; imported by the image worker.
  "libheif-js@1.23.5/libheif-wasm/libheif-bundle.mjs": "libheif-wasm/libheif-bundle.mjs",
  "libheif-js@1.23.5/libheif-wasm/LICENSE": "libheif-wasm/LICENSE",
};

const VENDOR_EXCALIDRAW_FILES = {
  "@excalidraw/excalidraw@0.18.1/fonts/": "dist/prod/fonts/",
};

/** Group → files; served at /vendor/<group>/<key>. */
export const VENDOR_FILES = { "3d": VENDOR_3D_FILES, heif: VENDOR_HEIF_FILES, excalidraw: VENDOR_EXCALIDRAW_FILES };

const TYPES = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function resolveSource(group, key) {
  const at = key.indexOf("@", 1);
  const slash = key.indexOf("/", at);
  const pkg = key.slice(0, at);
  const version = key.slice(at + 1, slash);
  // Not require.resolve: some of these packages don't export package.json.
  const pkgDir = path.join(NODE_MODULES, pkg);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  if (installed !== version) {
    throw new Error(
      `[vendor-libs] ${pkg} ${installed} is installed but /vendor/${group}/ expects ${version}; pin ${pkg}@${version}`,
    );
  }
  return path.resolve(pkgDir, VENDOR_FILES[group][key]);
}

function listDir(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...listDir(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    else out.push(`${prefix}${entry.name}`);
  }
  return out;
}

/** Every [group, key, source file] — directory keys expanded to their files. */
function* allFiles() {
  for (const [group, files] of Object.entries(VENDOR_FILES)) {
    for (const key of Object.keys(files)) {
      const source = resolveSource(group, key);
      if (key.endsWith("/")) {
        for (const rel of listDir(source)) yield [group, `${key}${rel}`, path.join(source, rel)];
      } else {
        yield [group, key, source];
      }
    }
  }
}

/** Source file for a requested /vendor/<group>/<key>, or null. */
function lookup(group, key) {
  const files = VENDOR_FILES[group];
  if (!files) return null;
  if (key in files && !key.endsWith("/")) return resolveSource(group, key);
  for (const dirKey of Object.keys(files)) {
    if (!dirKey.endsWith("/") || !key.startsWith(dirKey)) continue;
    const root = resolveSource(group, dirKey);
    const file = path.resolve(root, key.slice(dirKey.length));
    // Stay inside the mapped directory.
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return file;
  }
  return null;
}

export function vendorLibs() {
  return {
    name: "skynet-vendor-libs",
    configResolved() {
      for (const _ of allFiles()); // fail fast on missing packages / version drift
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const m = /\/vendor\/([a-z0-9]+)\/(.+)$/.exec(url);
        const file = m ? lookup(m[1], decodeURIComponent(m[2])) : null;
        if (!file) return next();
        res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const [group, key, source] of allFiles()) {
        this.emitFile({ type: "asset", fileName: `vendor/${group}/${key}`, source: fs.readFileSync(source) });
      }
    },
  };
}
