// ─── claude-session-api — probeIdentityTrappedWork wire shape (Phase 104 Plan 02) ─
//
// Byte-shape mirror of claude-session-api.count-bounties.test.ts. Type-level +
// one-shot-transport assertions for the WS request/response pair. Runs under
// vitest's jsdom env because probeIdentityTrappedWork opens a WebSocket via
// openClaudeSessionSocket. We swap window.WebSocket for a manual test stub so
// we can drive .onopen / .onmessage / .send / .close / .onerror / .onclose
// without a real server.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Manual WebSocket stub — captures the last-constructed instance so the test
// can call .onopen / .onmessage / .close by hand. openClaudeSessionSocket
// calls `new WebSocket(url)`, so replacing the global is sufficient.
type StubWS = {
  url: string;
  readyState: number;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let lastSocket: StubWS | null = null;
let realWebSocket: typeof WebSocket;

beforeEach(() => {
  realWebSocket = window.WebSocket;
  lastSocket = null;
  const StubCtor = function StubCtor(this: StubWS, url: string) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.send = vi.fn();
    this.close = vi.fn();
    lastSocket = this;
  } as unknown as typeof WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebSocket = StubCtor;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebSocket = realWebSocket;
});

describe("probeIdentityTrappedWork one-shot helper", () => {
  it("Test 1: opens a WebSocket, sends exactly one identity:probe-trapped-work frame, resolves on identity:trapped-work, then closes", async () => {
    const { probeIdentityTrappedWork } = await import("./claude-session-api.js");

    const targets = [
      { identityKey: "tina", hostId: null },
      { identityKey: "moxie", hostId: 42 },
    ];
    const promise = probeIdentityTrappedWork(targets);
    // A socket must have been constructed.
    expect(lastSocket).not.toBeNull();

    // Simulate socket open — helper sends the request.
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    expect(lastSocket!.send).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "identity:probe-trapped-work",
      targets,
    });

    // Simulate server response.
    const responsePayload = {
      type: "identity:trapped-work",
      results: [
        { identityKey: "tina", hostId: null, hasTrappedWork: true },
        { identityKey: "moxie", hostId: 42, hasTrappedWork: false, error: "boom" },
      ],
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    const resolved = await promise;
    expect(resolved).toEqual(responsePayload);
    expect(resolved.results[0].hasTrappedWork).toBe(true);
    expect(resolved.results[1].error).toBe("boom");
    // Helper closes the socket after receiving the response.
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("Test 2: onerror before response rejects with Error('Connection failed')", async () => {
    const { probeIdentityTrappedWork } = await import("./claude-session-api.js");

    const promise = probeIdentityTrappedWork([
      { identityKey: "tina", hostId: null },
    ]);
    // Fire onerror before any response.
    lastSocket!.onerror?.call(
      lastSocket as unknown as WebSocket,
      new Event("error"),
    );
    await expect(promise).rejects.toThrow("Connection failed");
  });

  it("Test 3: onclose before response rejects with Error('Connection failed')", async () => {
    const { probeIdentityTrappedWork } = await import("./claude-session-api.js");

    const promise = probeIdentityTrappedWork([
      { identityKey: "tina", hostId: null },
    ]);
    // Fire onclose before any response.
    lastSocket!.onclose?.call(
      lastSocket as unknown as WebSocket,
      new CloseEvent("close"),
    );
    await expect(promise).rejects.toThrow("Connection failed");
  });

  it("Test 4: unrelated frames are ignored; only identity:trapped-work resolves", async () => {
    const { probeIdentityTrappedWork } = await import("./claude-session-api.js");

    const promise = probeIdentityTrappedWork([
      { identityKey: "tina", hostId: null },
    ]);
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    // Unrelated frame — must NOT resolve.
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({ type: "other", stuff: "x" }),
      }),
    );
    expect(lastSocket!.close).not.toHaveBeenCalled();

    // Matching frame — resolves.
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "identity:trapped-work",
          results: [
            { identityKey: "tina", hostId: null, hasTrappedWork: true },
          ],
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved.results).toHaveLength(1);
    expect(resolved.results[0].hasTrappedWork).toBe(true);
  });

  it("Test 5: JSON parse errors on incoming messages are swallowed (keep waiting for a valid frame)", async () => {
    const { probeIdentityTrappedWork } = await import("./claude-session-api.js");

    const promise = probeIdentityTrappedWork([
      { identityKey: "tina", hostId: null },
    ]);
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    // Malformed JSON — helper must swallow the parse error and keep waiting.
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: "{not valid json" }),
    );
    expect(lastSocket!.close).not.toHaveBeenCalled();

    // Valid response afterwards — resolves.
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "identity:trapped-work",
          results: [
            { identityKey: "tina", hostId: null, hasTrappedWork: false },
          ],
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved.results[0].hasTrappedWork).toBe(false);
  });
});
