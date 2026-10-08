import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Readable } from "node:stream";

vi.mock("./polly-adapter.js", () => ({ synthesizeToPcm: vi.fn() }));

import {
  chooseVoice,
  clearVoiceListCache,
  getVoiceList,
  isRecognizedVoiceId,
  resolveTtsProvider,
  synthesizeWithRetries,
  VOICE_LIST_TTL_MS,
  VOICE_LIST_FAILURE_TTL_MS,
  defaultVoiceFor,
  type TtsProvider,
} from "./tts-provider.js";
import { TtsHttpError, TtsNotConfiguredError } from "./tts-errors.js";

function fakeProvider(overrides: Partial<TtsProvider> = {}): TtsProvider {
  return {
    id: "elevenlabs",
    sampleRate: 24000,
    maxCharsPerRequest: 100,
    defaultVoiceId: "DEFAULT",
    model: () => "m",
    listVoices: vi.fn(async () => [{ id: "a", name: "A" }, { id: "b", name: "B" }]),
    isOwnVoiceId: (id) => /^[a-z]$/.test(id),
    synthesize: vi.fn(async () => ({}) as Readable),
    isRetriable: (err) => err instanceof TtsHttpError && err.status === 429,
    isUnavailable: () => false,
    ...overrides,
  };
}

beforeEach(() => {
  clearVoiceListCache();
});

describe("resolveTtsProvider", () => {
  it("defaults to polly, picks named providers, refuses unknown values", () => {
    expect(resolveTtsProvider({}).id).toBe("polly");
    expect(resolveTtsProvider({ TTS_PROVIDER: " OpenAI " }).id).toBe("openai");
    expect(resolveTtsProvider({ TTS_PROVIDER: "elevenlabs" }).id).toBe("elevenlabs");
    expect(() => resolveTtsProvider({ TTS_PROVIDER: "chatterbox" })).toThrow(TtsNotConfiguredError);
  });
});

describe("isRecognizedVoiceId (write-side gate for saved voices)", () => {
  it("accepts a voice of ANY provider, regardless of which is active", () => {
    for (const id of ["Joanna", "Matthew", "marin", "nova", "SAz9YHcvj6GT2YYXdXww"]) {
      expect(isRecognizedVoiceId(id)).toBe(true);
    }
  });

  it("rejects legacy, unknown, over-long and non-string values", () => {
    for (const id of ["Elena.wav", "joanna", "NotAVoice", "", "x".repeat(65), 42, null, undefined]) {
      expect(isRecognizedVoiceId(id)).toBe(false);
    }
  });
});

describe("chooseVoice", () => {
  it("takes the first candidate the provider offers and reports the ones skipped", async () => {
    const choice = await chooseVoice(fakeProvider(), ["Joanna", "b", "a"]);
    expect(choice).toEqual({ voice: "b", source: 1, skipped: ["Joanna"], listUnavailable: false });
  });

  it("falls back to the provider default when no candidate is offered", async () => {
    const choice = await chooseVoice(fakeProvider(), ["Joanna", "z"]);
    expect(choice.voice).toBe("DEFAULT");
    expect(choice.source).toBe("default");
  });

  it("when the voice list is unreachable, still tries a candidate in the provider's own id format", async () => {
    const provider = fakeProvider({ listVoices: vi.fn(async () => { throw new Error("down"); }) });
    const choice = await chooseVoice(provider, ["Joanna", "z"]);
    expect(choice).toMatchObject({ voice: "z", listUnavailable: true });
  });

  it("does not fetch the list when there are no candidates", async () => {
    const provider = fakeProvider();
    expect((await chooseVoice(provider, [])).voice).toBe("DEFAULT");
    expect(provider.listVoices).not.toHaveBeenCalled();
  });
});

describe("getVoiceList", () => {
  it("reuses a fetched list within the TTL and refetches after it", async () => {
    const provider = fakeProvider();
    let t = 1_000;
    await getVoiceList(provider, () => t);
    t += VOICE_LIST_TTL_MS - 1;
    await getVoiceList(provider, () => t);
    expect(provider.listVoices).toHaveBeenCalledTimes(1);
    t += 2;
    await getVoiceList(provider, () => t);
    expect(provider.listVoices).toHaveBeenCalledTimes(2);
  });

  it("after a failure, fails fast for a short window, then really retries", async () => {
    const listVoices = vi
      .fn<TtsProvider["listVoices"]>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([{ id: "a", name: "A" }]);
    const provider = fakeProvider({ listVoices });
    let t = 1_000;
    await expect(getVoiceList(provider, () => t)).rejects.toThrow("down");
    t += VOICE_LIST_FAILURE_TTL_MS - 1;
    await expect(getVoiceList(provider, () => t)).rejects.toThrow("down");
    expect(listVoices).toHaveBeenCalledTimes(1);
    t += 2;
    await expect(getVoiceList(provider, () => t)).resolves.toEqual([{ id: "a", name: "A" }]);
    expect(listVoices).toHaveBeenCalledTimes(2);
  });
});

describe("synthesizeWithRetries", () => {
  it("retries errors the provider marks retriable, not others", async () => {
    vi.useFakeTimers();
    try {
      const synthesize = vi
        .fn<TtsProvider["synthesize"]>()
        .mockRejectedValueOnce(new TtsHttpError("elevenlabs", 429, "slow"))
        .mockResolvedValueOnce({} as Readable);
      const p = synthesizeWithRetries(fakeProvider({ synthesize }), "hi", "a", { reqId: "r", chunkIndex: 0 });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toEqual({});
      expect(synthesize).toHaveBeenCalledTimes(2);

      const fatal = vi.fn<TtsProvider["synthesize"]>().mockRejectedValue(new TtsHttpError("elevenlabs", 400, "bad"));
      await expect(
        synthesizeWithRetries(fakeProvider({ synthesize: fatal }), "hi", "a", { reqId: "r", chunkIndex: 0 }),
      ).rejects.toBeInstanceOf(TtsHttpError);
      expect(fatal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("defaultVoiceFor", () => {
  it("uses the provider default, or an override that is one of its voice ids", () => {
    const provider = fakeProvider();
    expect(defaultVoiceFor(provider, {})).toBe("DEFAULT");
    expect(defaultVoiceFor(provider, { TTS_DEFAULT_VOICE: " b " })).toBe("b");
  });

  it("refuses an override from another provider as a misconfiguration", () => {
    expect(() => defaultVoiceFor(fakeProvider(), { TTS_DEFAULT_VOICE: "Joanna" })).toThrow(TtsNotConfiguredError);
  });
});
