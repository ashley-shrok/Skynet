import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

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
  watchForStall,
  ttsStallTimeoutMs,
  TTS_STALL_TIMEOUT_MS_DEFAULT,
  TTS_STALL_TIMEOUT_MS_WITH_FALLBACK,
  resolveTtsFallback,
  type TtsProvider,
} from "./tts-provider.js";
import { TtsHttpError, TtsNotConfiguredError, TtsStallError } from "./tts-errors.js";

function fakeProvider(overrides: Partial<TtsProvider> = {}): TtsProvider {
  return {
    id: "elevenlabs",
    sampleRate: 24000,
    maxCharsPerRequest: 100,
    defaultVoiceId: "DEFAULT",
    model: () => "m",
    listVoices: vi.fn(async () => [{ id: "a", name: "A" }, { id: "b", name: "B" }]),
    isOwnVoiceId: (id) => /^[a-z]$/.test(id),
    synthesize: vi.fn(async () => Readable.from([])),
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
    expect(resolveTtsProvider({ TTS_PROVIDER: "Gemini" }).id).toBe("gemini");
    expect(() => resolveTtsProvider({ TTS_PROVIDER: "chatterbox" })).toThrow(TtsNotConfiguredError);
  });
});

describe("isRecognizedVoiceId (write-side gate for saved voices)", () => {
  it("accepts a voice of ANY provider, regardless of which is active", () => {
    for (const id of ["Joanna", "Matthew", "marin", "nova", "SAz9YHcvj6GT2YYXdXww", "Kore", "Zubenelgenubi"]) {
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
      const audio = Readable.from([]);
      const synthesize = vi
        .fn<TtsProvider["synthesize"]>()
        .mockRejectedValueOnce(new TtsHttpError("elevenlabs", 429, "slow"))
        .mockResolvedValueOnce(audio);
      const p = synthesizeWithRetries(fakeProvider({ synthesize }), "hi", "a", { reqId: "r", chunkIndex: 0 });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBe(audio);
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

describe("watchForStall", () => {
  // A stream whose bytes are pushed by hand, so tests control the gaps.
  const manual = () => new Readable({ read() {} });

  it("destroys a flowing stream with TtsStallError once it goes quiet", async () => {
    const stream = watchForStall(manual(), "openai", 30);
    const got: Buffer[] = [];
    const err = new Promise<unknown>((resolve) => stream.on("error", resolve));
    stream.on("data", (b: Buffer) => got.push(b));
    stream.push(Buffer.from([1, 2]));

    const e = await err;
    expect(e).toBeInstanceOf(TtsStallError);
    expect((e as TtsStallError).provider).toBe("openai");
    expect(Buffer.concat(got)).toEqual(Buffer.from([1, 2]));
  });

  it("keeps steady audio alive, and never times out while the consumer has it paused", async () => {
    const stream = watchForStall(manual(), "openai", 40);
    const onError = vi.fn();
    stream.on("error", onError);
    stream.on("data", () => {});
    for (let i = 0; i < 4; i++) {
      stream.push(Buffer.from([i]));
      await new Promise((r) => setTimeout(r, 20));
    }
    stream.pause(); // our own backpressure: a slow listener
    await new Promise((r) => setTimeout(r, 120));
    expect(onError).not.toHaveBeenCalled();
    stream.push(null);
    stream.resume();
    await new Promise((r) => stream.on("end", r));
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not start the flow itself — bytes pushed before the consumer attaches are kept", async () => {
    const stream = watchForStall(manual(), "openai", 1000);
    stream.push(Buffer.from([7, 8, 9]));
    stream.push(null);
    await new Promise((r) => setTimeout(r, 10));
    const got: Buffer[] = [];
    stream.on("data", (b: Buffer) => got.push(b));
    await new Promise((r) => stream.on("end", r));
    expect(Buffer.concat(got)).toEqual(Buffer.from([7, 8, 9]));
  });

  it("TTS_STALL_TIMEOUT_MS overrides the timeout; junk falls back to the default", () => {
    expect(ttsStallTimeoutMs({})).toBe(TTS_STALL_TIMEOUT_MS_DEFAULT);
    expect(ttsStallTimeoutMs({ TTS_STALL_TIMEOUT_MS: "250" })).toBe(250);
    expect(ttsStallTimeoutMs({ TTS_STALL_TIMEOUT_MS: "nope" })).toBe(TTS_STALL_TIMEOUT_MS_DEFAULT);
    expect(ttsStallTimeoutMs({ TTS_STALL_TIMEOUT_MS: "0" })).toBe(TTS_STALL_TIMEOUT_MS_DEFAULT);
  });
});

describe("defaultVoiceFor", () => {
  it("uses the provider default, or an override that is one of its voice ids", () => {
    const provider = fakeProvider();
    expect(defaultVoiceFor(provider, { TTS_PROVIDER: "elevenlabs" })).toBe("DEFAULT");
    expect(defaultVoiceFor(provider, { TTS_PROVIDER: "elevenlabs", TTS_DEFAULT_VOICE: " b " })).toBe("b");
  });

  it("refuses an override from another provider as a misconfiguration", () => {
    expect(() =>
      defaultVoiceFor(fakeProvider(), { TTS_PROVIDER: "elevenlabs", TTS_DEFAULT_VOICE: "Joanna" }),
    ).toThrow(TtsNotConfiguredError);
  });

  it("ignores the override on a provider that isn't the selected one (a backup uses its own default)", () => {
    expect(defaultVoiceFor(fakeProvider(), { TTS_PROVIDER: "openai", TTS_DEFAULT_VOICE: "marin" })).toBe("DEFAULT");
  });
});

describe("resolveTtsFallback", () => {
  it("unset, empty or none → no backup", () => {
    expect(resolveTtsFallback({})).toEqual({ kind: "none" });
    expect(resolveTtsFallback({ TTS_FALLBACK_PROVIDER: " " })).toEqual({ kind: "none" });
    expect(resolveTtsFallback({ TTS_FALLBACK_PROVIDER: "None" })).toEqual({ kind: "none" });
  });

  it("a known provider other than the selected one is the backup", () => {
    const fb = resolveTtsFallback({ TTS_PROVIDER: "openai", TTS_FALLBACK_PROVIDER: " ElevenLabs " });
    expect(fb.kind === "ok" && fb.provider.id).toBe("elevenlabs");
    const polly = resolveTtsFallback({ TTS_FALLBACK_PROVIDER: "openai" }); // primary defaults to polly
    expect(polly.kind === "ok" && polly.provider.id).toBe("openai");
  });

  it("an unknown value or the selected provider itself is ignored, never mapped elsewhere", () => {
    expect(resolveTtsFallback({ TTS_FALLBACK_PROVIDER: "azure" })).toEqual({ kind: "ignored", raw: "azure", reason: "unknown" });
    expect(resolveTtsFallback({ TTS_PROVIDER: "openai", TTS_FALLBACK_PROVIDER: "openai" })).toEqual({
      kind: "ignored",
      raw: "openai",
      reason: "same-as-primary",
    });
    expect(resolveTtsFallback({ TTS_FALLBACK_PROVIDER: "polly" })).toMatchObject({ reason: "same-as-primary" });
  });

  it("stall timeout is shorter only where a stall can hand off; an explicit override still wins", () => {
    expect(ttsStallTimeoutMs({}, { canHandOff: true })).toBe(TTS_STALL_TIMEOUT_MS_WITH_FALLBACK);
    expect(ttsStallTimeoutMs({}, { canHandOff: false })).toBe(TTS_STALL_TIMEOUT_MS_DEFAULT);
    expect(ttsStallTimeoutMs({ TTS_STALL_TIMEOUT_MS: "250" }, { canHandOff: true })).toBe(250);
  });
});
