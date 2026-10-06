import { getBasePath } from "@/lib/base-path";

/**
 * Thin wrapper over the Online3DViewer engine (MIT, on three.js). We drive
 * its low-level Viewer + ThreeModelLoader ourselves instead of its
 * EmbeddedViewer, which writes importer error messages (which can quote the
 * file) into the page with innerHTML.
 *
 * The engine loads its optional decoders (STEP/IGES, Rhino, IFC, Draco) on
 * demand from <base>/vendor/3d/ — see scripts/patch-online-3d-viewer.cjs and
 * scripts/vendor-libs.mjs — never from a CDN.
 */

export type O3dv = typeof import("online-3d-viewer");

let enginePromise: Promise<O3dv> | null = null;

export function loadEngine(): Promise<O3dv> {
  // Absolute: the STEP decoder runs in a blob: worker, where relative URLs
  // don't resolve against the page.
  (globalThis as { __SKYNET_3D_LIBS__?: string }).__SKYNET_3D_LIBS__ = new URL(
    `${getBasePath()}/vendor/3d/`,
    window.location.href,
  ).href;
  enginePromise ??= import("online-3d-viewer").catch((err) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
}

const IMPORT_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Lighting for physically-based (glTF) materials, served from /vendor/3d/.
 * Resolves once the map has loaded (or after 5 s), so a snapshot taken
 * afterwards is lit.
 */
export function applyEnvironment(OV: O3dv, viewer: InstanceType<O3dv["Viewer"]>): Promise<void> {
  const base = (globalThis as { __SKYNET_3D_LIBS__?: string }).__SKYNET_3D_LIBS__ ?? "/vendor/3d/";
  const faces = ["posx", "negx", "posy", "negy", "posz", "negz"].map(
    (face) => `${base}online-3d-viewer@0.18.0/envmap/${face}.jpg`,
  );
  const settings = new OV.EnvironmentSettings(faces, false);
  // Viewer.SetEnvironmentMapSettings has no completion callback; its
  // shading model does.
  const shading = (viewer as unknown as {
    shadingModel?: { SetEnvironmentMapSettings(s: unknown, onLoaded: () => void): void; UpdateShading(): void };
  }).shadingModel;
  if (!shading) {
    viewer.SetEnvironmentMapSettings(settings);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    shading.SetEnvironmentMapSettings(settings, () => {
      clearTimeout(timer);
      viewer.Render();
      resolve();
    });
    shading.UpdateShading();
    viewer.Render();
  });
}

/**
 * The loader already rotates models whose importer declares Z-up into the
 * viewer's Y-up world. The OpenCascade importer (STEP/IGES/BREP) declares Y
 * although CAD files are Z-up by convention, so those start with Z up.
 */
const Z_UP_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "brp"]);

export interface LoadedModel {
  vertices: number;
  triangles: number;
  /** Bounding-box size in the file's own units. */
  size: [number, number, number] | null;
  /** Files the model references that weren't available (textures, .mtl, .bin). */
  missingFiles: string[];
  /** Initial camera up axis (world axes, after the loader's own rotation). */
  upAxis: "Y" | "Z";
}

/** Plain-text reason for a failed import, never the importer's raw message. */
export class ModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelLoadError";
  }
}

type ImportResultLike = {
  model: {
    VertexCount(): number;
    TriangleCount(): number;
  };
  missingFiles: string[] | null;
};

/**
 * Import `file` into `viewer` and frame it. Resolves once the geometry is
 * on screen (textures may still stream in and re-render on their own).
 */
export function loadModelInto(
  OV: O3dv,
  viewer: InstanceType<O3dv["Viewer"]>,
  loader: InstanceType<O3dv["ThreeModelLoader"]>,
  file: File,
): Promise<LoadedModel> {
  return new Promise<LoadedModel>((resolveRaw, rejectRaw) => {
    // Some importers throw from async callbacks (e.g. glTF's JSON.parse on a
    // damaged file) instead of reporting through onLoadError. Treat any
    // uncaught error while an import is running as that import failing, and
    // give up after IMPORT_TIMEOUT_MS rather than spinning forever.
    const onError = () =>
      reject(new ModelLoadError("This model couldn't be imported; it may be damaged or use unsupported features."));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    const timer = setTimeout(
      () => reject(new ModelLoadError("Importing this model took too long.")),
      IMPORT_TIMEOUT_MS,
    );
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
    const resolve = (v: LoadedModel) => {
      done();
      resolveRaw(v);
    };
    const reject = (e: Error) => {
      done();
      rejectRaw(e);
    };

    viewer.Clear();
    const settings = new OV.ImportSettings();
    loader.LoadModel(OV.InputFilesFromFileObjects([file]), settings, {
      onLoadStart: () => {},
      onFileListProgress: () => {},
      onFileLoadProgress: () => {},
      onImportStart: () => {},
      onVisualizationStart: () => {},
      onModelFinished: (result: ImportResultLike, threeObject: unknown) => {
        viewer.SetMainObject(threeObject);
        const sphere = viewer.GetBoundingSphere(() => true);
        viewer.AdjustClippingPlanesToSphere(sphere);
        const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
        const up = Z_UP_EXTENSIONS.has(ext) ? "Z" : "Y";
        viewer.SetUpVector(up === "Z" ? OV.Direction.Z : OV.Direction.Y, false);
        viewer.FitSphereToWindow(sphere, false);

        let size: LoadedModel["size"] = null;
        const box = OV.GetBoundingBox(result.model);
        if (box) {
          size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
        }
        resolve({
          vertices: result.model.VertexCount(),
          triangles: result.model.TriangleCount(),
          size,
          missingFiles: result.missingFiles ?? [],
          upAxis: up,
        });
      },
      onTextureLoaded: () => viewer.Render(),
      onLoadError: (error: { code: number }) => {
        const codes = OV.ImportErrorCode;
        reject(
          new ModelLoadError(
            error.code === codes.NoImportableFile
              ? "This file isn't a 3D format the viewer can read."
              : error.code === codes.FailedToLoadFile
                ? "The model file couldn't be read."
                : "This model couldn't be imported; it may be damaged or use unsupported features.",
          ),
        );
      },
    });
  });
}

/** Free the WebGL context right away (browsers cap live contexts at ~16). */
export function destroyViewer(viewer: InstanceType<O3dv["Viewer"]>): void {
  try {
    const renderer = (viewer as unknown as { renderer?: { forceContextLoss?: () => void } }).renderer;
    viewer.Destroy();
    renderer?.forceContextLoss?.();
  } catch {
    /* already gone */
  }
}
