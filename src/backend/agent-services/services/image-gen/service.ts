/**
 * image-gen — generate images from a prompt (optionally editing a reference
 * image) with OpenAI gpt-image-1, and hand the PNGs back to the agent.
 *
 * Agent side: substrate/scripts/image-gen (wrapper over skynet-service) and
 * substrate/skills/image-gen/SKILL.md.
 *
 * Limits: 5 requests in flight, a fleet-wide requests-per-minute cap from
 * SKYNET_IMAGE_GEN_RPM (default 30), and a 5-minute TTL matching the
 * helper's own wait.
 */

import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";
import { callOpenAiImageGen } from "./adapter.js";

/** OpenAI's own prompt cap for gpt-image-1. */
export const PROMPT_MAX_LENGTH = 4000;

/** OpenAI's per-image limit on /images/edits. */
export const MAX_REF_BYTES = 20 * 1024 * 1024;

export const IMAGE_GEN_MODEL = "gpt-image-1";
const DEFAULT_SIZE = "1024x1024";

export const imageGenInput = z.strictObject({
  prompt: z
    .string()
    .max(PROMPT_MAX_LENGTH, `must be at most ${PROMPT_MAX_LENGTH} characters`)
    .refine((s) => s.trim().length > 0, "must not be empty"),
  size: z.string().optional(),
  quality: z.string().optional(),
  n: z.number().int().min(1).max(10).optional(),
});

/** SKYNET_IMAGE_GEN_RPM, default 30, floor 1. */
export function imageGenRpmFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = parseInt(env.SKYNET_IMAGE_GEN_RPM ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function createImageGenService(
  callOpenAi: typeof callOpenAiImageGen = callOpenAiImageGen,
) {
  return defineService({
    name: "image-gen",
    description: "Generate images from a prompt with OpenAI gpt-image-1",
    input: imageGenInput,
    attachments: {
      ref: {
        extensions: ["png", "jpg", "jpeg", "webp"],
        maxBytes: MAX_REF_BYTES,
      },
    },
    secrets: ["OPENAI_API_KEY"],
    ttlMs: 5 * 60 * 1000,
    concurrency: 5,
    rateLimitPerMinute: () => imageGenRpmFromEnv(),
    maxQueueDepth: 10_000,

    async handle(input, ctx) {
      const ref = ctx.attachments.ref;
      const result = await callOpenAi(
        { ...input, ...(ref ? { ref: ref.filename } : {}) },
        ref?.bytes,
      );
      if (result.ok === false) return fail(result.reason, result.message);
      return ok(
        {
          size: input.size ?? DEFAULT_SIZE,
          model: IMAGE_GEN_MODEL,
          n: result.images.length,
          generation_time_ms: result.generation_time_ms,
        },
        result.images.map((bytes) => ({ ext: "png", bytes })),
      );
    },
  });
}

export default createImageGenService();
