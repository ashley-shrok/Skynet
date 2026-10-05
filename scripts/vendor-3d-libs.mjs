/**
 * Decoder libraries (and the lighting environment map) Online3DViewer loads on demand (STEP/IGES via OpenCascade,
 * Rhino .3dm, IFC, Draco-compressed glTF). Upstream fetches them from
 * cdn.jsdelivr.net; scripts/patch-online-3d-viewer.cjs points it at
 * <base>/vendor/3d/ instead, and this Vite plugin serves those files from
 * node_modules in dev and emits them into the build — so the browser never
 * pulls code from a third party.
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
export const VENDOR_3D_FILES = {
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

const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".jpg": "image/jpeg" };

function resolveSource(key) {
  const at = key.indexOf("@", 1);
  const slash = key.indexOf("/", at);
  const pkg = key.slice(0, at);
  const version = key.slice(at + 1, slash);
  // Not require.resolve: some of these packages don't export package.json.
  const pkgDir = path.join(NODE_MODULES, pkg);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  if (installed !== version) {
    throw new Error(
      `[vendor-3d] ${pkg} ${installed} is installed but Online3DViewer requests ${version}; pin ${pkg}@${version}`,
    );
  }
  return path.join(pkgDir, VENDOR_3D_FILES[key]);
}

export function vendor3dLibs() {
  let base = "/";
  return {
    name: "skynet-vendor-3d-libs",
    configResolved(config) {
      base = config.base;
      for (const key of Object.keys(VENDOR_3D_FILES)) resolveSource(key); // fail fast
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const marker = "/vendor/3d/";
        const i = url.indexOf(marker);
        const key = i >= 0 ? decodeURIComponent(url.slice(i + marker.length)) : null;
        if (!key || !(key in VENDOR_3D_FILES)) return next();
        res.setHeader("Content-Type", TYPES[path.extname(key)] ?? "application/octet-stream");
        fs.createReadStream(resolveSource(key)).pipe(res);
      });
    },
    generateBundle() {
      for (const key of Object.keys(VENDOR_3D_FILES)) {
        this.emitFile({
          type: "asset",
          fileName: `vendor/3d/${key}`,
          source: fs.readFileSync(resolveSource(key)),
        });
      }
    },
    get base() {
      return base;
    },
  };
}
