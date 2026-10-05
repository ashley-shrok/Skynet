import { extensionOf } from "../registry-ext";

/** Image formats the decoded-image viewer handles (kept tiny: the registry imports it). */

export type ImageDocKind = "tiff" | "heic" | "psd" | "raw";

export const TIFF_EXTENSIONS = ["tif", "tiff"];
export const HEIC_EXTENSIONS = ["heic", "heif", "hif"];
export const PSD_EXTENSIONS = ["psd", "psb"];
export const RAW_EXTENSIONS = [
  "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "rwl",
  "raf", "pef", "srw", "3fr", "iiq", "erf", "kdc", "dcr", "mrw", "x3f",
];

export function imageDocKind(filename: string): ImageDocKind | null {
  const ext = extensionOf(filename) ?? "";
  if (TIFF_EXTENSIONS.includes(ext)) return "tiff";
  if (HEIC_EXTENSIONS.includes(ext)) return "heic";
  if (PSD_EXTENSIONS.includes(ext)) return "psd";
  if (RAW_EXTENSIONS.includes(ext)) return "raw";
  return null;
}
