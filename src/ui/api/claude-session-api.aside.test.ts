import { describe, it, expect } from "vitest";
import type {
  AsideArmPayload,
  AsideDismissedEvent,
  AsideDismissedPayload,
  AsideReadyEvent,
  ClaudeSessionServerEvent,
} from "./claude-session-api.js";

// Phase 14 Plan 02 Task 1 — RED-gate tests for the four new WS wire types.
//
// These tests exercise the `import type { … }` surface of the file plus
// the discriminated-union membership of the server-event union. If any of
// the four new type names are missing from claude-session-api.ts, the
// `import type { … }` block above will error at tsc time and vitest fails
// to load the module.
//
// Per CONTEXT.md § Trigger (locked 2026-07-26): AsideArmPayload has NO
// payload beyond the `type` tag — the backend derives hostId + tmuxSession
// from the connection's own captured state, NOT from client-supplied fields.
// Per T-14-02-01 mitigation, AsideDismissedPayload's hostId + tmuxSession
// fields are informational only — the backend uses connection-scoped state
// for the actual send-keys target.

describe("Phase 14 Wave 2 — new WS wire types (Task 1)", () => {
  it("AsideReadyEvent literal type tag is 'aside_ready' with a text string field", () => {
    const ev = { type: "aside_ready", text: "the agent is doing X" } satisfies AsideReadyEvent;
    expect(ev.type).toBe("aside_ready");
    expect(typeof ev.text).toBe("string");
  });

  it("AsideDismissedEvent literal type tag is 'aside_dismissed' with no payload beyond type", () => {
    const ev = { type: "aside_dismissed" } satisfies AsideDismissedEvent;
    expect(ev.type).toBe("aside_dismissed");
    // Compile-time assertion: no extra required fields — { type } alone satisfies.
  });

  it("AsideArmPayload literal type tag is 'aside_arm' with NO payload beyond type (CONTEXT.md § Trigger lock)", () => {
    const p = { type: "aside_arm" } satisfies AsideArmPayload;
    expect(p.type).toBe("aside_arm");
    // Compile-time assertion: no extra required fields — the frontend does not
    // send hostId/tmuxSession because the backend derives them from the
    // connection's own captured state (set during connectToPane).
  });

  it("AsideDismissedPayload literal type tag is 'aside_dismissed' with hostId + tmuxSession (informational per T-14-02-01)", () => {
    const p = {
      type: "aside_dismissed",
      hostId: 7,
      tmuxSession: "identity-session",
    } satisfies AsideDismissedPayload;
    expect(p.type).toBe("aside_dismissed");
    expect(p.hostId).toBe(7);
    expect(p.tmuxSession).toBe("identity-session");
  });

  it("AsideReadyEvent is assignable to the ClaudeSessionServerEvent discriminated union", () => {
    const ready: AsideReadyEvent = { type: "aside_ready", text: "hello" };
    const asServerEvent: ClaudeSessionServerEvent = ready;
    // Runtime narrowing to prove the tag survived the widening.
    if (asServerEvent.type === "aside_ready") {
      expect(asServerEvent.text).toBe("hello");
    } else {
      throw new Error("aside_ready tag did not narrow correctly through the union");
    }
  });

  it("AsideDismissedEvent is assignable to the ClaudeSessionServerEvent discriminated union", () => {
    const dismissed: AsideDismissedEvent = { type: "aside_dismissed" };
    const asServerEvent: ClaudeSessionServerEvent = dismissed;
    if (asServerEvent.type === "aside_dismissed") {
      // Type narrowed correctly — no additional required fields on the aside_dismissed member.
      expect(asServerEvent.type).toBe("aside_dismissed");
    } else {
      throw new Error("aside_dismissed tag did not narrow correctly through the union");
    }
  });
});
