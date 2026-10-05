import { getBasePath } from "@/lib/base-path";

/** Vendored viewer version — public/pdfjs/v<PDFJS_VERSION>/ (see its README). */
export const PDFJS_VERSION = "6.4.299";

const root = () => `${getBasePath()}/pdfjs/v${PDFJS_VERSION}`;

/** Viewer page for a same-origin PDF URL (the viewer refuses other origins). */
export function pdfViewerUrl(fileUrl: string): string {
  return `${root()}/web/viewer.html?file=${encodeURIComponent(fileUrl)}`;
}

/**
 * The pdf.js library module and its worker, for chip thumbnails. Absolute
 * URLs: Vite's dev server rewrites root-relative dynamic imports and then
 * refuses to serve files from public/ to them.
 */
const absolute = (path: string) => new URL(path, window.location.href).href;
export const pdfLibUrl = (): string => absolute(`${root()}/build/pdf.mjs`);
export const pdfWorkerUrl = (): string => absolute(`${root()}/build/pdf.worker.mjs`);

/**
 * Stylesheet injected into the viewer (the viewer's CSP blocks inline
 * styles). Versioned in its name because nginx caches /pdfjs/ immutably.
 */
export const pdfEmbedCssUrl = (): string => `${getBasePath()}/pdfjs/skynet-embed.v1.css`;
