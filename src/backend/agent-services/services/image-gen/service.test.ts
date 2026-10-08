import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, sshLogger: stub };
});

import {
  createImageGenService,
  imageGenInput,
  imageGenRpmFromEnv,
} from "./service.js";
import type { ServiceContext } from "../../engine/types.js";

const ctx = (
  attachments: ServiceContext["attachments"] = {},
): ServiceContext => ({
  requestId: "0b5c2f9e-1a2b-4c3d-8e9f-001122334455",
  host: { id: "1", idNum: 1 },
  attachments,
  secrets: { OPENAI_API_KEY: "k" },
  log: { info: vi.fn(), warn: vi.fn() },
  now: () => 0,
});

describe("image-gen input", () => {
  it("accepts prompt plus passthroughs", () => {
    expect(
      imageGenInput.safeParse({
        prompt: "a cat",
        size: "512x512",
        quality: "high",
        n: 2,
      }).success,
    ).toBe(true);
  });
  it.each([
    ["empty prompt", { prompt: " " }],
    ["long prompt", { prompt: "x".repeat(4001) }],
    ["n out of range", { prompt: "a", n: 11 }],
    ["fractional n", { prompt: "a", n: 1.5 }],
    ["model override", { prompt: "a", model: "dall-e-3" }],
  ])("rejects %s", (_n, value) => {
    expect(imageGenInput.safeParse(value).success).toBe(false);
  });
});

describe("image-gen service", () => {
  it("returns metadata and one PNG output per image", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      images: [Buffer.from("a"), Buffer.from("b")],
      generation_time_ms: 900,
    }));
    const result = await createImageGenService(call).handle(
      { prompt: "a cat", n: 2 },
      ctx(),
    );
    expect(call).toHaveBeenCalledWith({ prompt: "a cat", n: 2 }, undefined);
    expect(result).toEqual({
      ok: true,
      result: {
        size: "1024x1024",
        model: "gpt-image-1",
        n: 2,
        generation_time_ms: 900,
      },
      files: [
        { ext: "png", bytes: Buffer.from("a") },
        { ext: "png", bytes: Buffer.from("b") },
      ],
    });
  });

  it("sends the reference image to the edits path", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      images: [Buffer.from("x")],
      generation_time_ms: 1,
    }));
    const ref = {
      filename: "u.in.ref.jpg",
      ext: "jpg",
      bytes: Buffer.from("ref"),
    };
    await createImageGenService(call).handle({ prompt: "edit" }, ctx({ ref }));
    expect(call).toHaveBeenCalledWith(
      { prompt: "edit", ref: "u.in.ref.jpg" },
      ref.bytes,
    );
  });

  it("passes adapter failures through as the error code", async () => {
    const call = vi.fn(async () => ({
      ok: false as const,
      reason: "content_blocked" as const,
      message: "no",
    }));
    expect(
      await createImageGenService(call).handle({ prompt: "x" }, ctx()),
    ).toEqual({
      ok: false,
      code: "content_blocked",
      message: "no",
    });
  });

  it("reads SKYNET_IMAGE_GEN_RPM with a default of 30", () => {
    expect(imageGenRpmFromEnv({})).toBe(30);
    expect(imageGenRpmFromEnv({ SKYNET_IMAGE_GEN_RPM: "60" })).toBe(60);
    expect(imageGenRpmFromEnv({ SKYNET_IMAGE_GEN_RPM: "0" })).toBe(30);
    expect(imageGenRpmFromEnv({ SKYNET_IMAGE_GEN_RPM: "junk" })).toBe(30);
  });
});
