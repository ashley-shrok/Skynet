import type { DocMeta } from "./decode-core";

/** Messages between the image viewer and its decoding worker. */
export type ImageKind = "tiff" | "psd" | "heic";

export type ImageRequest =
  | { type: "open"; kind: ImageKind; bytes: ArrayBuffer; heifUrl: string }
  | { type: "frame"; index: number };

export type ImageResult = { meta: DocMeta } | { width: number; height: number; rgba: ArrayBuffer };

export type ImageMessage = { id: number; request: ImageRequest };
export type ImageReply = { id: number; ok: true; result: ImageResult } | { id: number; ok: false; error: string };
