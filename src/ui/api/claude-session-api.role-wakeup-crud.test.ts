// ─── claude-session-api — role-name-keyed wakeup CRUD one-shots (Phase 90 Plan 90-09 Task 3) ─
//
// Byte-shape mirror of claude-session-api.update-role-file-by-name.test.ts
// scaffolding. Covers the three wakeup mutation helpers:
//   - createRoleWakeupByName  → role:create-wakeup / role:wakeup-created
//   - updateRoleWakeupByName  → role:update-wakeup / role:wakeup-updated
//   - deleteRoleWakeupByName  → role:delete-wakeup / role:wakeup-deleted
//
// All three resolve with the FRESH {wakeups} list post-write (backend echoes
// server-truth list in the response envelope — see claude-session-server.ts
// L1798/L1876).
//
// Test map:
//   W1. createRoleWakeupByName happy path — sends role:create-wakeup with spec.
//   W2. updateRoleWakeupByName happy path — sends role:update-wakeup with spec.
//   W3. deleteRoleWakeupByName happy path — sends role:delete-wakeup with wakeupName.
//   W4. createRoleWakeupByName error envelope rejects.
//   W5. updateRoleWakeupByName error envelope rejects.
//   W6. deleteRoleWakeupByName error envelope rejects.

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

const VALID_SPEC = {
  name: "morning check",
  enabled: true,
  schedule: { cron: "0 9 * * *" },
  instruction: "greet",
};

const FRESH_WAKEUPS = [
  {
    slug: "morning-check",
    name: "morning check",
    enabled: true,
    scheduleHuman: "every morning at 09:00",
    schedule: { cron: "0 9 * * *" },
    instruction: "greet",
  },
];

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

// ─── createRoleWakeupByName ──────────────────────────────────────────────
describe("createRoleWakeupByName one-shot helper", () => {
  it("W1: sends role:create-wakeup frame with spec; resolves {wakeups} on role:wakeup-created", async () => {
    const { createRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = createRoleWakeupByName({
      roleName: "box-maintainer",
      hostId: 3,
      spec: VALID_SPEC,
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:create-wakeup",
      roleName: "box-maintainer",
      hostId: 3,
      spec: VALID_SPEC,
    });

    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-created",
          wakeups: FRESH_WAKEUPS,
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ wakeups: FRESH_WAKEUPS });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("W4: rejects with Error(env.error) on role:wakeup-created envelope carrying `error`", async () => {
    const { createRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = createRoleWakeupByName({
      roleName: "../evil",
      spec: VALID_SPEC,
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-created",
          wakeups: [],
          error: "invalid roleName",
        }),
      }),
    );

    await expect(promise).rejects.toThrow(/invalid roleName/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});

// ─── updateRoleWakeupByName ──────────────────────────────────────────────
describe("updateRoleWakeupByName one-shot helper", () => {
  it("W2: sends role:update-wakeup frame with spec; resolves {wakeups} on role:wakeup-updated", async () => {
    const { updateRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = updateRoleWakeupByName({
      roleName: "box-maintainer",
      hostId: 3,
      spec: { ...VALID_SPEC, enabled: false },
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:update-wakeup",
      roleName: "box-maintainer",
      hostId: 3,
      spec: { ...VALID_SPEC, enabled: false },
    });

    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-updated",
          wakeups: FRESH_WAKEUPS,
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ wakeups: FRESH_WAKEUPS });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("W5: rejects with Error(env.error) on role:wakeup-updated envelope carrying `error`", async () => {
    const { updateRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = updateRoleWakeupByName({
      roleName: "box-maintainer",
      spec: { ...VALID_SPEC, name: "" },
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-updated",
          wakeups: [],
          error: "spec.name required",
        }),
      }),
    );

    await expect(promise).rejects.toThrow(/spec.name required/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});

// ─── deleteRoleWakeupByName ──────────────────────────────────────────────
describe("deleteRoleWakeupByName one-shot helper", () => {
  it("W3: sends role:delete-wakeup frame with wakeupName; resolves {wakeups} on role:wakeup-deleted", async () => {
    const { deleteRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = deleteRoleWakeupByName({
      roleName: "box-maintainer",
      hostId: 3,
      wakeupName: "morning-check",
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    const sentPayload = JSON.parse(lastSocket!.send.mock.calls[0][0] as string);
    expect(sentPayload).toEqual({
      type: "role:delete-wakeup",
      roleName: "box-maintainer",
      hostId: 3,
      wakeupName: "morning-check",
    });

    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-deleted",
          wakeups: [],
        }),
      }),
    );

    const resolved = await promise;
    expect(resolved).toEqual({ wakeups: [] });
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });

  it("W6: rejects with Error(env.error) on role:wakeup-deleted envelope carrying `error`", async () => {
    const { deleteRoleWakeupByName } = await import("./claude-session-api.js");

    const promise = deleteRoleWakeupByName({
      roleName: "box-maintainer",
      wakeupName: "../evil",
    });
    lastSocket!.onopen?.call(
      lastSocket as unknown as WebSocket,
      new Event("open"),
    );
    lastSocket!.onmessage?.call(
      lastSocket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "role:wakeup-deleted",
          wakeups: [],
          error: "invalid wakeup slug",
        }),
      }),
    );

    await expect(promise).rejects.toThrow(/invalid wakeup slug/);
    expect(lastSocket!.close).toHaveBeenCalledTimes(1);
  });
});
