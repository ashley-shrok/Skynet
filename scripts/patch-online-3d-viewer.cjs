// Online3DViewer loads its optional decoders (STEP/IGES, Rhino, IFC, Draco)
// from cdn.jsdelivr.net at runtime. Point those URLs at our own origin
// instead: <globalThis.__SKYNET_3D_LIBS__>/<package>@<version>/..., served by
// the vendor-libs Vite plugin (scripts/vendor-libs.mjs). Skynet's 3D viewer
// sets __SKYNET_3D_LIBS__ to an absolute URL before loading the engine (the
// STEP worker runs from a blob: URL, so relative paths won't do).
//
// Fails the install if a CDN URL survives: a new Online3DViewer version must
// be re-checked rather than silently fetching code from a third party.
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "node_modules", "online-3d-viewer", "build", "engine", "o3dv.module.js");

if (!fs.existsSync(file)) {
  console.log("[patch-online-3d-viewer] online-3d-viewer not found, skipping");
  process.exit(0);
}

const CDN = "https://cdn.jsdelivr.net/npm/";
const BASE = "(globalThis.__SKYNET_3D_LIBS__ || '/vendor/3d/')";

let source = fs.readFileSync(file, "utf8");
const before = source;
// '<CDN><rest>'  →  (BASE + '<rest>')
source = source.replace(/'https:\/\/cdn\.jsdelivr\.net\/npm\/([^']*)'/g, (_m, rest) => `(${BASE} + '${rest}')`);

if (source.includes(CDN) || source.includes("cdn.jsdelivr")) {
  console.error("[patch-online-3d-viewer] a CDN URL is left in o3dv.module.js; update the patch for this version");
  process.exit(1);
}
if (source !== before) {
  fs.writeFileSync(file, source);
  console.log("[patch-online-3d-viewer] decoder URLs now point at /vendor/3d/");
} else {
  console.log("[patch-online-3d-viewer] already patched");
}
