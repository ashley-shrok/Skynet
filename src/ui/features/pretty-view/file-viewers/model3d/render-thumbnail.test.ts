import { describe, it, expect, vi, beforeEach } from "vitest";

const engine = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  loads: [] as string[],
}));

vi.mock("./engine", () => {
  class Viewer {
    Init() {}
    Resize() {}
    SetBackgroundColor() {}
    GetImageAsDataUrl() {
      return "data:image/png;base64,AAAA";
    }
  }
  class ThreeModelLoader {
    Destroy() {}
  }
  class RGBAColor {}
  return {
    loadEngine: async () => ({ Viewer, ThreeModelLoader, RGBAColor }),
    applyEnvironment: async () => {},
    destroyViewer: () => {
      engine.active -= 1;
    },
    loadModelInto: async (_OV: unknown, _v: unknown, _l: unknown, file: File) => {
      engine.active += 1;
      engine.maxActive = Math.max(engine.maxActive, engine.active);
      engine.loads.push(file.name);
      await new Promise((r) => setTimeout(r, 5));
      if (file.name === "bad.glb") throw new Error("broken");
      return { vertices: 3, triangles: 1, size: null, missingFiles: [], upAxis: "Y" };
    },
  };
});

import { renderModelThumbnail } from "./render-thumbnail";

beforeEach(() => {
  engine.active = 0;
  engine.maxActive = 0;
  engine.loads = [];
});

describe("renderModelThumbnail", () => {
  it("renders one model at a time and caches per URL", async () => {
    const blob = async () => new Blob([new Uint8Array([1])]);
    const results = await Promise.all([
      renderModelThumbnail("/a", "a.glb", blob),
      renderModelThumbnail("/b", "b.stl", blob),
      renderModelThumbnail("/a", "a.glb", blob),
    ]);
    expect(results.map((r) => r.image)).toEqual(Array(3).fill("data:image/png;base64,AAAA"));
    expect(engine.loads).toEqual(["a.glb", "b.stl"]);
    expect(engine.maxActive).toBe(1);
  });

  it("does not cache failures, and a failure doesn't stall the queue", async () => {
    const blob = async () => new Blob([new Uint8Array([1])]);
    await expect(renderModelThumbnail("/bad", "bad.glb", blob)).rejects.toThrow("broken");
    await expect(renderModelThumbnail("/c", "c.glb", blob)).resolves.toBeTruthy();
    await expect(renderModelThumbnail("/bad", "bad.glb", blob)).rejects.toThrow("broken");
    expect(engine.loads).toEqual(["bad.glb", "c.glb", "bad.glb"]);
  });
});
