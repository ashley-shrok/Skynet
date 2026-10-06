import { getBasePath } from "@/lib/base-path";

/**
 * Excalidraw loads its hand-drawn fonts from EXCALIDRAW_ASSET_PATH (default:
 * esm.sh). Point it at our own copy (scripts/vendor-libs.mjs) before the
 * library loads, so drawings never fetch from a third party.
 */
export const EXCALIDRAW_VERSION = "0.18.1";

export function pointExcalidrawAtOwnAssets(): void {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
    `${getBasePath()}/vendor/excalidraw/@excalidraw/excalidraw@${EXCALIDRAW_VERSION}/`,
    window.location.href,
  ).href;
}
