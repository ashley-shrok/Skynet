// ─── claude-session-api — role-name-keyed read one-shots (Phase 90 Plan 90-09 Task 3) ─
//
// Byte-shape mirror of claude-session-api.update-role-file-by-name.test.ts
// scaffolding. Each helper opens a WebSocket, sends its wire type on open,
// resolves with the payload on the matching response event, rejects with
// Error(env.error) if the envelope carries `error`. Then closes the socket.
//
// Test map:
//   R1. getRoleFileByName happy path — sends role:get-file; resolves {markdown}.
//   R2. getRoleFileByName error envelope — rejects Error(env.error).
//
// Phase 134 Plan 134-02 retired R5+R6 (listRoleWakeupsByName happy path +
// error envelope) together with the listRoleWakeupsByName helper.
// Phase 136 retired R3+R4 (listBountiesForRoleName happy path + error
// envelope) together with the listBountiesForRoleName helper.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

// ─── getRoleFileByName ───────────────────────────────────────────────────
describe("getRoleFileByName one-shot helper", () => {
  it("R1: sends role:get-file frame; resolves {markdown} on role:file-loaded; closes socket", async () => {
    const { getRoleFileByName } = await import("./claude-session-api.js");

    const promise = getRoleFileByName({ roleName: "box-maintainer", hostId: 3 });
    expect(lastSocket).not.toBeNull();

    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    expect(lastSocket!.send).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:get-file",
      roleName: "box-maintainer",
      hostId: 3,
    });

    const responsePayload = {
      type: "role:file-loaded",
      markdown: "---\ntitle: Boxes\n---\nbody",
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ markdown: "---\ntitle: Boxes\n---\nbody" });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("R2: rejects with Error(env.error) when role:file-loaded envelope carries `error`", async () => {
    const { getRoleFileByName } = await import("./claude-session-api.js");

    const promise = getRoleFileByName({ roleName: "../evil" });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    const responsePayload = {
      type: "role:file-loaded",
      markdown: "",
      error: "invalid roleName",
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    await expect(promise).rejects.toThrow(/invalid roleName/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});

