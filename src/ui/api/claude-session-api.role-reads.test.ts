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
//   R3. listBountiesForRoleName happy path — sends role:list-bounties; resolves
//       {bounties, archivedBounties}; includeArchived threads through.
//   R4. listBountiesForRoleName error envelope — rejects Error(env.error).
//   R5. listRoleWakeupsByName happy path — sends role:list-wakeups; resolves {wakeups}.
//   R6. listRoleWakeupsByName error envelope — rejects Error(env.error).

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

// ─── listBountiesForRoleName ─────────────────────────────────────────────
describe("listBountiesForRoleName one-shot helper", () => {
  it("R3: sends role:list-bounties (with includeArchived); resolves {bounties, archivedBounties}", async () => {
    const { listBountiesForRoleName } = await import("./claude-session-api.js");

    const promise = listBountiesForRoleName({
      roleName: "box-maintainer",
      hostId: 3,
      includeArchived: true,
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:list-bounties",
      roleName: "box-maintainer",
      hostId: 3,
      includeArchived: true,
    });

    const bounties = [{ slug: "b1" }, { slug: "b2" }];
    const archivedBounties = [{ slug: "a1" }];
    const responsePayload = {
      type: "role:bounties-loaded",
      bounties,
      archivedBounties,
    };
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(responsePayload) }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ bounties, archivedBounties });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("R4: rejects with Error(env.error) on role:bounties-loaded envelope carrying `error`", async () => {
    const { listBountiesForRoleName } = await import("./claude-session-api.js");

    const promise = listBountiesForRoleName({ roleName: "box-maintainer", hostId: 999 });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:bounties-loaded",
          bounties: [],
          archivedBounties: [],
          error: "host not found",
        }),
      }),
    );

    await expect(promise).rejects.toThrow(/host not found/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});

// ─── listRoleWakeupsByName ───────────────────────────────────────────────
describe("listRoleWakeupsByName one-shot helper", () => {
  it("R5: sends role:list-wakeups; resolves {wakeups} on role:wakeups-loaded", async () => {
    const { listRoleWakeupsByName } = await import("./claude-session-api.js");

    const promise = listRoleWakeupsByName({ roleName: "box-maintainer" });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:list-wakeups",
      roleName: "box-maintainer",
      // hostId omitted from args -> undefined in payload (JSON.stringify drops it)
    });

    const wakeups = [
      {
        slug: "morning-check",
        name: "morning check",
        enabled: true,
        scheduleHuman: "every morning at 09:00",
        schedule: { cron: "0 9 * * *" },
        instruction: "greet",
      },
    ];
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({ type: "role:wakeups-loaded", wakeups }),
      }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ wakeups });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("R6: rejects with Error(env.error) on role:wakeups-loaded envelope carrying `error`", async () => {
    const { listRoleWakeupsByName } = await import("./claude-session-api.js");

    const promise = listRoleWakeupsByName({ roleName: "BAD_NAME" });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );

    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeups-loaded",
          wakeups: [],
          error: "invalid roleName",
        }),
      }),
    );

    await expect(promise).rejects.toThrow(/invalid roleName/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});
