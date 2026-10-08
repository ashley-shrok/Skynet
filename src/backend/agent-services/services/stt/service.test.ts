import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, sshLogger: stub, databaseLogger: stub };
});
// The Bedrock provider pulls in the AWS SDK client at import time.
vi.mock("../../../voice/nova-sonic-adapter.js", () => ({
  transcribeNovaSonic: vi.fn(),
}));

import {
  createSttService,
  STT_ATTEMPT_TIMEOUT_MS,
  sttInput,
  sttRpmFromEnv,
} from "./service.js";
import type { ServiceContext } from "../../engine/types.js";
import type { SttProvider } from "../../../voice/stt-provider.js";
import {
  SttHttpError,
  SttNetworkError,
  SttNotConfiguredError,
} from "../../../voice/stt-errors.js";
import { elevenLabsSttProvider } from "../../../voice/stt-http-providers.js";

const audio = {
  filename: "u.in.audio.m4a",
  ext: "m4a",
  bytes: Buffer.from("AUDIO"),
};

const ctx = (): ServiceContext => ({
  requestId: "0b5c2f9e-1a2b-4c3d-8e9f-001122334455",
  host: { id: "1", idNum: 1 },
  attachments: { audio },
  secrets: {},
  userSecrets: {},
  log: { info: vi.fn(), warn: vi.fn() },
  now: () => 0,
});

describe("stt input", () => {
  it("takes no options", () => {
    expect(sttInput.safeParse({}).success).toBe(true);
    expect(sttInput.safeParse({ model: "x" }).success).toBe(false);
    expect(sttInput.safeParse({ language: "en" }).success).toBe(false);
  });
});

describe("stt service", () => {
  it("transcribes with the instance's provider", async () => {
    const transcribe = vi.fn(async () => "hello there");
    const service = createSttService({
      resolveProvider: () => elevenLabsSttProvider,
      transcribe,
    });
    expect(await service.handle({}, ctx())).toEqual({
      ok: true,
      result: {
        text: "hello there",
        provider: "elevenlabs",
        audio_bytes: 5,
        transcription_time_ms: 0,
      },
    });
    expect(transcribe).toHaveBeenCalledWith(elevenLabsSttProvider, {
      audio: audio.bytes,
      mimetype: "audio/mp4",
      ext: "m4a",
      timeoutMs: STT_ATTEMPT_TIMEOUT_MS,
    });
  });

  it("uses STT_PROVIDER by default", async () => {
    const saved = process.env.STT_PROVIDER;
    process.env.STT_PROVIDER = "groq";
    try {
      const transcribe = vi.fn(async (p: SttProvider) => p.id);
      const r = await createSttService({ transcribe }).handle({}, ctx());
      expect(r).toMatchObject({ ok: true, result: { provider: "groq" } });
    } finally {
      if (saved === undefined) delete process.env.STT_PROVIDER;
      else process.env.STT_PROVIDER = saved;
    }
  });

  it.each([
    [
      "unknown STT_PROVIDER",
      () => {
        throw new SttNotConfiguredError("unknown STT_PROVIDER");
      },
      undefined,
      "not_configured",
    ],
    [
      "missing key",
      undefined,
      new SttNotConfiguredError("no key"),
      "not_configured",
    ],
    [
      "rejected key",
      undefined,
      new SttHttpError("elevenlabs", 401, "bad key"),
      "not_configured",
    ],
    [
      "rate limited after retries",
      undefined,
      new SttHttpError("elevenlabs", 429, ""),
      "provider_unavailable",
    ],
    [
      "network failure",
      undefined,
      new SttNetworkError("elevenlabs", new Error("x")),
      "provider_unavailable",
    ],
    [
      "bad audio",
      undefined,
      new SttHttpError("elevenlabs", 400, "invalid audio"),
      "transcription_failed",
    ],
  ] as const)("maps %s to %s", async (_n, resolve, thrown, code) => {
    const service = createSttService({
      resolveProvider: resolve ?? (() => elevenLabsSttProvider),
      transcribe: async () => {
        throw thrown;
      },
    });
    const r = await service.handle({}, ctx());
    expect(r).toMatchObject({ ok: false, code });
    // Provider response bodies stay in the backend log.
    expect(JSON.stringify(r)).not.toMatch(/bad key|invalid audio/);
  });

  it("reads SKYNET_STT_RPM with a default of 30", () => {
    expect(sttRpmFromEnv({})).toBe(30);
    expect(sttRpmFromEnv({ SKYNET_STT_RPM: "60" })).toBe(60);
    expect(sttRpmFromEnv({ SKYNET_STT_RPM: "0" })).toBe(30);
    expect(sttRpmFromEnv({ SKYNET_STT_RPM: "junk" })).toBe(30);
  });
});
