import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postSpeakStream } from "./voice-api";

describe("postSpeakStream (Phase 19 / patch #237)", () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  let fetchBodies: string[] = [];

  beforeEach(() => {
    capturedUrl = undefined;
    capturedInit = undefined;
    fetchBodies = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      fetchBodies.push(init.body as string);
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });
    // jsdom provides a localStorage stub already — start clean each test.
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  // Test 1: URL and method
  it("POSTs to /voice/speak-stream with method POST", async () => {
    await postSpeakStream("hello");
    expect(capturedUrl).toBe("/voice/speak-stream");
    expect(capturedInit?.method).toBe("POST");
  });

  // Test 2: body without voices
  it("sends JSON body with only text when no voice candidates are given", async () => {
    await postSpeakStream("hello");
    await postSpeakStream("hello", []);
    for (const call of [0, 1]) {
      expect(JSON.parse(fetchBodies[call])).toEqual({ text: "hello" });
    }
  });

  // Test 3: body with voice candidates, in preference order
  it("sends JSON body with text and voice candidates when provided", async () => {
    await postSpeakStream("hello", ["Joanna", "marin"]);
    const parsed = JSON.parse(capturedInit?.body as string);
    expect(parsed).toEqual({ text: "hello", voices: ["Joanna", "marin"] });
  });

  // Test 4: JWT present in localStorage
  it("attaches Authorization header when JWT is present in localStorage", async () => {
    window.localStorage.setItem("jwt", "eyJhbGciOiJIUzI1NiJ9.abc.def");
    await postSpeakStream("hi");
    const authHeader = new Headers(capturedInit!.headers as HeadersInit).get("Authorization");
    expect(authHeader).toBe("Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
  });

  // Test 5: JWT absent from localStorage
  it("does NOT send Authorization header when localStorage has no jwt key", async () => {
    // localStorage cleared in beforeEach
    await postSpeakStream("hi");
    const authHeader = new Headers(capturedInit!.headers as HeadersInit).get("Authorization");
    expect(authHeader).toBeNull();
  });

  // Test 6: Content-Type header
  it("sets Content-Type to application/json", async () => {
    await postSpeakStream("hi");
    const contentType = new Headers(capturedInit!.headers as HeadersInit).get("Content-Type");
    expect(contentType).toBe("application/json");
  });

  // Test 7: non-ok Response passes through without throw
  it("returns non-2xx Response without throwing (caller inspects response.ok)", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: "TTS stream non-2xx", status: 503 }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const response = await postSpeakStream("hi");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json).toEqual({ error: "TTS stream non-2xx", status: 503 });
  });

  // Test 8: Response body is unread (bodyUsed === false when helper returns)
  it("returns Response with unread body (bodyUsed is false)", async () => {
    const response = await postSpeakStream("hi");
    expect(response.bodyUsed).toBe(false);
  });
});
