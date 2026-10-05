import { applyEnvironment, destroyViewer, loadEngine, loadModelInto, type LoadedModel } from "./engine";

/**
 * Render a model to a PNG data URL for a chat chip: off-screen viewer, one
 * frame, then the WebGL context is released. Renders run one at a time
 * (browsers cap live WebGL contexts) and results are cached per URL.
 */

export interface ModelThumbnail {
  image: string;
  info: LoadedModel;
}

const WIDTH = 320;
const HEIGHT = 200;
const cache = new Map<string, Promise<ModelThumbnail>>();
let queue: Promise<unknown> = Promise.resolve();

async function render(bytes: Blob, filename: string): Promise<ModelThumbnail> {
  const OV = await loadEngine();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none`;
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  const viewer = new OV.Viewer();
  const loader = new OV.ThreeModelLoader();
  try {
    viewer.Init(canvas);
    viewer.Resize(WIDTH, HEIGHT);
    viewer.SetBackgroundColor(new OV.RGBAColor(26, 23, 18, 255));
    const lit = applyEnvironment(OV, viewer);
    const info = await loadModelInto(OV, viewer, loader, new File([bytes], filename));
    await lit;
    const ratio = window.devicePixelRatio || 1;
    const image: string = viewer.GetImageAsDataUrl(WIDTH * ratio, HEIGHT * ratio, false);
    return { image, info };
  } finally {
    loader.Destroy();
    destroyViewer(viewer);
    host.remove();
  }
}

export function renderModelThumbnail(url: string, filename: string, fetchBytes: () => Promise<Blob>): Promise<ModelThumbnail> {
  let job = cache.get(url);
  if (!job) {
    job = queue.then(async () => render(await fetchBytes(), filename));
    queue = job.catch(() => undefined);
    job.catch(() => cache.delete(url));
    cache.set(url, job);
  }
  return job;
}
