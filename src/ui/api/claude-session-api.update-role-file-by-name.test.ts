// ─── claude-session-api — updateRoleFileByName wire shape (Phase 90 Plan 90-03 Task 3) ─
//
// One-shot WS helper for the RoleModal (Phase 90 Plan 90-04) save path.
// Opens a WebSocket, sends a role:update-file frame on open, resolves with
// {markdown} on the role:file-updated response envelope, rejects with
// Error(env.error) if the envelope carries `error`. Then closes the socket.
//
// Byte-shape mirror of claude-session-api.count-bounties.test.ts scaffolding:
// swap window.WebSocket for a manual stub that captures the last-constructed
// instance, drive .onopen/.onmessage by hand, assert on .send + .close.
//
// Test map (per plan Task 3 <behavior>):
//   A. Happy path: sends role:update-file with {roleName, hostId, contents};
//      resolves {markdown} on role:file-updated response; closes socket.
//   B. Error envelope: rejects with Error(env.error) when response carries
//      `error`; still closes socket (no live subscription).

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

describe("updateRoleFileByName one-shot helper", () => {
  it("test A: sends role:update-file frame; resolves {markdown} on role:file-updated response; closes socket", async () => {
    const { updateRoleFileByName } = await import("./claude-session-api.js");

    const promise = updateRoleFileByName(
      "box-maintainer",
      3,
      "---\ntitle: Skynet\n---",
    );
    expect(lastSocket).not.toBeNull();

    // Simulate socket open — helper sends the request.
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    expect(lastSocket!.send).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:update-file",
      roleName: "box-maintainer",
      hostId: 3,
      contents: "---\ntitle: Skynet\n---",
    });

    // Simulate server response — server-echoed confirmed markdown post-write.
    const responsePayload = {
      type: "role:file-updated",
      markdown: "---\ntitle: Skynet\n---",
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ markdown: "---\ntitle: Skynet\n---" });

    // Test B (embedded): connection closed by client after single response
    // received — proves no live subscription.
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("test B: rejects with Error(env.error) when response envelope carries `error`", async () => {
    const { updateRoleFileByName } = await import("./claude-session-api.js");

    const promise = updateRoleFileByName("box-maintainer", 3, "body");
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    // Server returns an error envelope (e.g. oversized payload gate)
    const responsePayload = {
      type: "role:file-updated",
      markdown: "",
      error: "markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES",
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    await expect(promise).rejects.toThrow(/IDMEDIT_MAX_MARKDOWN_BYTES/);
    // Socket closed even on error (single response consumed).
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});
