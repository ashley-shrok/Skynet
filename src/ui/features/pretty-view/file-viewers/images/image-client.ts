import type { DocMeta } from "./decode-core";
import type { ImageKind, ImageReply, ImageRequest, ImageResult } from "./image-protocol";
import { getBasePath } from "@/lib/base-path";

/** Where the image worker imports libheif from (scripts/vendor-libs.mjs). */
export const HEIF_MODULE_PATH = "vendor/heif/libheif-js@1.23.5/libheif-wasm/libheif-bundle.mjs";

/** Main-thread handle on one decoding worker (one document). */
export class ImageClient {
  private worker = new Worker(new URL("./image.worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: ImageResult) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ImageReply>) => {
      const reply = event.data;
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if ("error" in reply) p.reject(new Error(reply.error));
      else p.resolve(reply.result);
    };
    this.worker.onerror = (event) => {
      const err = new Error(event.message || "The image decoder failed.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  async open(kind: ImageKind, bytes: ArrayBuffer): Promise<DocMeta> {
    const heifUrl = new URL(`${getBasePath()}/${HEIF_MODULE_PATH}`, window.location.href).href;
    const result = await this.call({ type: "open", kind, bytes, heifUrl }, [bytes]);
    return (result as { meta: DocMeta }).meta;
  }

  async frame(index: number): Promise<ImageData> {
    const r = (await this.call({ type: "frame", index })) as { width: number; height: number; rgba: ArrayBuffer };
    return new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height);
  }

  close(): void {
    this.worker.terminate();
    const err = new Error("Closed.");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call(request: ImageRequest, transfer: Transferable[] = []): Promise<ImageResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, request }, transfer);
    });
  }
}
