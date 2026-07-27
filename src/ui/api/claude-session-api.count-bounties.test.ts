// ─── claude-session-api — countIdentityBounties wire shape (quick 260727-tb1) ─
//
// Type-level + one-shot-transport assertions for the new WS request/response
// pair that Task 2 adds. Runs under vitest's jsdom env because
// countIdentityBounties opens a WebSocket via openClaudeSessionSocket. We
// swap window.WebSocket for a manual test stub so we can drive .onopen /
// .onmessage / .send / .close without a real server.

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
  // openClaudeSessionSocket calls `new WebSocket(url)` — we replace the
  // global with a constructor-shaped function whose instances are the
  // captured stubs. Using `function` (not an arrow) preserves the `new`
  // callable shape vitest's spy wrapping would otherwise fight.
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

describe("countIdentityBounties one-shot helper", () => {
  it("opens a WebSocket, sends exactly one identity:count-bounties frame, resolves on identity:bounty-counts, then closes", async () => {
    const { countIdentityBounties } = await import("./claude-session-api.js");

    const targets = [
      { identityKey: "tina", hostId: null },
      { identityKey: "moxie", hostId: 42 },
    ];
    const promise = countIdentityBounties(targets);
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
      type: "identity:count-bounties",
      targets,
    });

    // Simulate server response.
    const responsePayload = {
      type: "identity:bounty-counts",
      counts: [
        { identityKey: "tina", hostId: null, onDeckCount: 3 },
        { identityKey: "moxie", hostId: 42, onDeckCount: 0, error: "boom" },
      ],
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    const resolved = await promise;
    expect(resolved).toEqual(responsePayload);
    // Helper closes the socket after receiving the response.
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("ignores unrecognized frames and only resolves on the matching type", async () => {
    const { countIdentityBounties } = await import("./claude-session-api.js");

    const promise = countIdentityBounties([
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
        data: JSON.stringify({ type: "message", role: "user", content: "x" }),
      }),
    );
    expect(lastSocket!.close).not.toHaveBeenCalled();

    // Matching frame — resolves.
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "identity:bounty-counts",
          counts: [{ identityKey: "tina", hostId: null, onDeckCount: 1 }],
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved.counts).toHaveLength(1);
    expect(resolved.counts[0].onDeckCount).toBe(1);
  });
});
