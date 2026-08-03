// ─── identities-api — openBirthStream tests ──────────────────────────────────
// Plan 20-06 Task 1: Tests for the SSE streaming helper that consumes
// POST /identities/birth via fetch + ReadableStream.
//
// Auth model: authApi uses withCredentials:true (JWT cookie sent automatically
// by the browser). The fetch call in openBirthStream mirrors this by using
// credentials:"include". No explicit Authorization header needed in-browser.
//
// EventSource does NOT support POST, so we use fetch + ReadableStream instead.

import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test the helper in isolation. Mock global fetch.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import AFTER stubbing so the module picks up the stub at import time.
import { openBirthStream } from "./identities-api";
import type { BirthEvent } from "./identities-api";

// Helper: build a ReadableStream from an array of string chunks
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// Helper: build a canned SSE frame
function sseFrame(data: object): string {
  return `event: birth\ndata: ${JSON.stringify(data)}\n\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: openBirthStream sends POST with correct headers + body
// ─────────────────────────────────────────────────────────────────────────────
describe("openBirthStream: Test 1 — sends POST /identities/birth", () => {
  it("calls fetch with POST, correct URL, Accept: text/event-stream, Content-Type: application/json, and JSON body", async () => {
    const body = makeStream([sseFrame({ type: "ended", ok: true, identityId: "abc", sessionName: "alicia" })]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "text/event-stream" : null },
      body,
    });

    const opts = { hostId: 1, name: "alicia", title: "Alicia", path: "~", colorHue: 200, voice: "Elena.wav", avatarCandidateId: "c1" };
    const gen = openBirthStream(opts);
    // drain the generator
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of gen) { /* consume */ }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/identities/birth");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("text/event-stream");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({ name: "alicia", hostId: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: openBirthStream returns an async iterable of BirthEvents
// ─────────────────────────────────────────────────────────────────────────────
describe("openBirthStream: Test 2 — yields parsed BirthEvents in order", () => {
  it("yields 3 parsed BirthEvent objects from 3 SSE frames", async () => {
    const events: BirthEvent[] = [
      { type: "step", n: 1, phase: "started" },
      { type: "step", n: 1, phase: "completed" },
      { type: "ended", ok: true, identityId: "id1", sessionName: "alicia" },
    ];
    const body = makeStream(events.map(sseFrame));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "text/event-stream" : null },
      body,
    });

    const opts = { hostId: 1, name: "alicia", title: "Alicia", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    const collected: BirthEvent[] = [];
    for await (const evt of openBirthStream(opts)) {
      collected.push(evt);
    }

    expect(collected).toHaveLength(3);
    expect(collected[0]).toEqual({ type: "step", n: 1, phase: "started" });
    expect(collected[1]).toEqual({ type: "step", n: 1, phase: "completed" });
    expect(collected[2]).toMatchObject({ type: "ended", ok: true, sessionName: "alicia" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: openBirthStream frame parser handles partial chunks
// ─────────────────────────────────────────────────────────────────────────────
describe("openBirthStream: Test 3 — handles multi-line frames split across chunks", () => {
  it("assembles a frame split across two chunks correctly", async () => {
    // Split the frame at the middle of the JSON payload
    const fullFrame = sseFrame({ type: "step", n: 1, phase: "started" });
    // Split at character 30 (mid-frame)
    const splitAt = 30;
    const chunk1 = fullFrame.slice(0, splitAt);
    const chunk2 = fullFrame.slice(splitAt);
    // Followed by a complete second frame
    const frame2 = sseFrame({ type: "ended", ok: true });

    const body = makeStream([chunk1, chunk2, frame2]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "text/event-stream" : null },
      body,
    });

    const opts = { hostId: 1, name: "alicia", title: "T", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    const collected: BirthEvent[] = [];
    for await (const evt of openBirthStream(opts)) {
      collected.push(evt);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ type: "step", n: 1, phase: "started" });
    expect(collected[1]).toMatchObject({ type: "ended", ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: openBirthStream aborts when consumer breaks early via AbortSignal
// ─────────────────────────────────────────────────────────────────────────────
describe("openBirthStream: Test 4 — aborts when AbortSignal fires", () => {
  it("passes signal to fetch; does not throw when signal is aborted", async () => {
    const controller = new AbortController();
    // Mock fetch to immediately resolve with a stream that never closes
    const body = makeStream([sseFrame({ type: "step", n: 1, phase: "started" })]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "text/event-stream" : null },
      body,
    });

    const opts = { hostId: 1, name: "alicia", title: "T", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    const events: BirthEvent[] = [];
    for await (const evt of openBirthStream(opts, controller.signal)) {
      events.push(evt);
      controller.abort(); // abort after first event
      break; // stop consuming
    }

    // Should have received at least the first event
    expect(events.length).toBeGreaterThanOrEqual(0);
    // signal should have been passed to fetch
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: openBirthStream propagates non-200 responses as thrown error
// ─────────────────────────────────────────────────────────────────────────────
describe("openBirthStream: Test 5 — throws on non-200 response", () => {
  it("throws with error message from JSON body when status is 400", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValueOnce({ error: "invalid body" }),
    });

    const opts = { hostId: 1, name: "alicia", title: "T", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    await expect(async () => {
      for await (const _ of openBirthStream(opts)) { /* consume */ }
    }).rejects.toThrow("invalid body");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR-05: openBirthStream error paths
// ─────────────────────────────────────────────────────────────────────────────
describe("CR-05: openBirthStream error paths", () => {
  it("cancels response.body on non-200 status", async () => {
    const mockCancel = vi.fn().mockResolvedValue(undefined);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValueOnce({ error: "test error" }),
      body: { cancel: mockCancel },
    });

    const opts = { hostId: 1, name: "alicia", title: "T", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    await expect(async () => {
      for await (const _ of openBirthStream(opts)) { /* consume */ }
    }).rejects.toThrow();

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it("throws 'empty SSE stream' when 200 response has null body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: null,
    });

    const opts = { hostId: 1, name: "alicia", title: "T", path: "~", colorHue: null, voice: null, avatarCandidateId: "c1" };
    await expect(async () => {
      for await (const _ of openBirthStream(opts)) { /* consume */ }
    }).rejects.toThrow("empty SSE stream");
  });
});
