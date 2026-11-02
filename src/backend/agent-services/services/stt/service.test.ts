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
    const transcribe = vi.fn(async () => ({
      kind: "ok" as const,
      text: "hello there",
      provider: elevenLabsSttProvider,
    }));
    const service = createSttService({ transcribe });
    expect(await service.handle({}, ctx())).toEqual({
      ok: true,
      result: {
        text: "hello there",
        provider: "elevenlabs",
        audio_bytes: 5,
        transcription_time_ms: 0,
      },
    });
    expect(transcribe).toHaveBeenCalledWith(
      {
        audio: audio.bytes,
        mimetype: "audio/mp4",
        ext: "m4a",
        timeoutMs: STT_ATTEMPT_TIMEOUT_MS,
      },
      "0b5c2f9e",
    );
  });

  it("uses STT_PROVIDER, then STT_FALLBACK_PROVIDER, and reports who transcribed", async () => {
    const saved = { ...process.env };
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.STT_FALLBACK_PROVIDER = "groq";
    process.env.ELEVENLABS_API_KEY = "el";
    process.env.GROQ_API_KEY = "gq";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      fetchMock
        .mockResolvedValueOnce(
          new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ text: "from groq" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      const r = await createSttService().handle({}, ctx());
      expect(r).toMatchObject({
        ok: true,
        result: { text: "from groq", provider: "groq" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      process.env = saved;
    }
  });

  it.each([
    [
      "unknown STT_PROVIDER",
      new SttNotConfiguredError("unknown STT_PROVIDER"),
      undefined,
      "not_configured",
    ],
    [
      "missing key",
      new SttNotConfiguredError("no key"),
      elevenLabsSttProvider,
      "not_configured",
    ],
    [
      "rejected key",
      new SttHttpError("elevenlabs", 401, "bad key"),
      elevenLabsSttProvider,
      "not_configured",
    ],
    [
      "rate limited after retries",
      new SttHttpError("elevenlabs", 429, ""),
      elevenLabsSttProvider,
      "provider_unavailable",
    ],
    [
      "network failure",
      new SttNetworkError("elevenlabs", new Error("x")),
      elevenLabsSttProvider,
      "provider_unavailable",
    ],
    [
      "bad audio",
      new SttHttpError("elevenlabs", 400, "invalid audio"),
      elevenLabsSttProvider,
      "transcription_failed",
    ],
  ] as const)("maps %s to %s", async (_n, err, provider, code) => {
    const service = createSttService({
      transcribe: async () => ({
        kind: "failed" as const,
        err,
        provider: provider as SttProvider | undefined,
      }),
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
