import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Bedrock provider pulls in the AWS SDK client singleton at import time;
// stub it so this suite stays a pure unit test.
vi.mock("./nova-sonic-adapter.js", () => ({ transcribeNovaSonic: vi.fn() }));

import { resolveSttProvider, STT_PROVIDER_IDS } from "./stt-provider.js";
import { SttHttpError, SttNetworkError, SttNotConfiguredError } from "./stt-errors.js";
import {
  elevenLabsSttProvider,
  groqSttProvider,
  mistralSttProvider,
} from "./stt-http-providers.js";
import { bedrockSttProvider } from "./stt-bedrock.js";

const INPUT = { audio: Buffer.from("fake webm"), mimetype: "audio/webm;codecs=opus", ext: "webm" };

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveSttProvider", () => {
  it("defaults to bedrock when STT_PROVIDER is unset or blank", () => {
    expect(resolveSttProvider({}).id).toBe("bedrock");
    expect(resolveSttProvider({ STT_PROVIDER: "  " }).id).toBe("bedrock");
  });

  it.each(STT_PROVIDER_IDS)("selects %s (case/whitespace-insensitive)", (id) => {
    expect(resolveSttProvider({ STT_PROVIDER: ` ${id.toUpperCase()} ` }).id).toBe(id);
  });

  it("throws SttNotConfiguredError for an unknown provider instead of falling back", () => {
    expect(() => resolveSttProvider({ STT_PROVIDER: "whisperx" })).toThrow(SttNotConfiguredError);
  });
});

describe("HTTP STT providers", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    delete process.env.STT_MODEL;
    delete process.env.STT_LANGUAGE;
    process.env.ELEVENLABS_API_KEY = "el-key";
    process.env.MISTRAL_API_KEY = "mi-key";
    process.env.GROQ_API_KEY = "gq-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  function lastRequest(): { url: string; headers: Record<string, string>; form: FormData } {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return {
      url: String(url),
      headers: init!.headers as Record<string, string>,
      form: init!.body as FormData,
    };
  }

  it("elevenlabs: posts to /v1/speech-to-text with xi-api-key, scribe_v2, audio tags off", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ text: " hello there ", words: [] }));

    await expect(elevenLabsSttProvider.transcribe(INPUT)).resolves.toBe("hello there");

    const { url, headers, form } = lastRequest();
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(headers).toEqual({ "xi-api-key": "el-key" });
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.has("language_code")).toBe(false);
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm;codecs=opus");
    expect(Buffer.from(await file.arrayBuffer()).equals(INPUT.audio)).toBe(true);
  });

  it("mistral: posts to /v1/audio/transcriptions with Bearer auth and voxtral-mini-latest", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ text: "voxtral says hi" }));

    await expect(mistralSttProvider.transcribe(INPUT)).resolves.toBe("voxtral says hi");

    const { url, headers, form } = lastRequest();
    expect(url).toBe("https://api.mistral.ai/v1/audio/transcriptions");
    expect(headers).toEqual({ Authorization: "Bearer mi-key" });
    expect(form.get("model")).toBe("voxtral-mini-latest");
  });

  it("groq: posts to the OpenAI-compatible endpoint with whisper-large-v3-turbo, temp 0", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ text: "whisper says hi" }));

    await expect(groqSttProvider.transcribe(INPUT)).resolves.toBe("whisper says hi");

    const { url, headers, form } = lastRequest();
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(headers).toEqual({ Authorization: "Bearer gq-key" });
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("response_format")).toBe("json");
  });

  it("STT_MODEL and STT_LANGUAGE override the model and pin the language", async () => {
    process.env.STT_MODEL = "scribe_v9";
    process.env.STT_LANGUAGE = "en";
    fetchMock.mockImplementation(async () => okJson({ text: "x" }));

    await elevenLabsSttProvider.transcribe(INPUT);
    expect(lastRequest().form.get("model_id")).toBe("scribe_v9");
    expect(lastRequest().form.get("language_code")).toBe("en");

    await groqSttProvider.transcribe(INPUT);
    expect(lastRequest().form.get("model")).toBe("scribe_v9");
    expect(lastRequest().form.get("language")).toBe("en");
  });

  it("missing API key → SttNotConfiguredError (unavailable), and no request is sent", async () => {
    delete process.env.GROQ_API_KEY;

    const err = await groqSttProvider.transcribe(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SttNotConfiguredError);
    expect(groqSttProvider.isUnavailable(err)).toBe(true);
    expect(groqSttProvider.isRetriable(err)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-2xx → SttHttpError carrying status and a truncated body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(2000), { status: 400 }));

    const err = await mistralSttProvider.transcribe(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SttHttpError);
    expect((err as SttHttpError).status).toBe(400);
    expect((err as SttHttpError).body.length).toBe(500);
  });

  it("fetch rejection (DNS/socket/timeout) → SttNetworkError, retriable", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "TimeoutError" }));

    const err = await groqSttProvider.transcribe(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SttNetworkError);
    expect(groqSttProvider.isRetriable(err)).toBe(true);
  });

  it("response without a text field is an error, not an empty transcript", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ transcript: "wrong shape" }));
    await expect(groqSttProvider.transcribe(INPUT)).rejects.toThrow(/missing "text"/);
  });

  it.each([
    [new SttHttpError("groq", 429, ""), true, false],
    [new SttHttpError("groq", 503, ""), true, false],
    [new SttHttpError("groq", 400, ""), false, false],
    [new SttHttpError("groq", 401, ""), false, true],
    [new SttHttpError("groq", 403, ""), false, true],
    [new SttNetworkError("groq", new TypeError("fetch failed")), true, false],
    [new TypeError("not from fetch"), false, false],
    [new Error("boom"), false, false],
  ])("classifies %o → retriable=%s unavailable=%s", (err, retriable, unavailable) => {
    expect(groqSttProvider.isRetriable(err)).toBe(retriable);
    expect(groqSttProvider.isUnavailable(err)).toBe(unavailable);
  });
});

describe("bedrock provider error classification", () => {
  it.each([
    ["ModelStreamErrorException", true],
    ["ThrottlingException", true],
    ["ValidationException", false],
  ])("%s → retriable=%s", (name, retriable) => {
    expect(bedrockSttProvider.isRetriable(Object.assign(new Error(), { name }))).toBe(retriable);
  });

  it("AccessDeniedException → unavailable", () => {
    const err = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    expect(bedrockSttProvider.isUnavailable(err)).toBe(true);
  });
});
