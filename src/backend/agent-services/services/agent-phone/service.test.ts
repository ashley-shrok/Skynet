import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, sshLogger: stub };
});
// lookup.ts reaches the real DB; the service under test gets fakes instead.
vi.mock("../../../database/db/index.js", () => ({ getDb: vi.fn() }));

import {
  createAgentPhoneService,
  agentPhoneInput,
  type AgentPhoneDeps,
} from "./service.js";
import type { ServiceContext } from "../../engine/types.js";

const input = {
  caller_name: "Clipper the Box Maintainer",
  to_user: "alice",
  message: "CI failed",
};

const ctx: ServiceContext = {
  requestId: "0b5c2f9e-1a2b-4c3d-8e9f-001122334455",
  host: { id: "3", idNum: 3 },
  attachments: {},
  secrets: { BLAND_API_KEY: "k" },
  log: { info: vi.fn(), warn: vi.fn() },
  now: () => 0,
};

function deps(overrides: Partial<AgentPhoneDeps> = {}): AgentPhoneDeps {
  return {
    getUserByUsername: vi.fn(async () => ({
      id: "u-alice",
      phoneE164: "+15555550100",
    })),
    userHasRegisteredHost: vi.fn(async () => true),
    placeCallAndAwait: vi.fn(async () => ({
      outcome: "completed" as const,
      transcript: "voice: hi\nuser: on it",
      call_length_seconds: 42,
    })),
    sleep: async () => {},
    ...overrides,
  };
}

describe("agent-phone input", () => {
  it("accepts the three fields", () => {
    expect(agentPhoneInput.safeParse(input).success).toBe(true);
  });
  it.each([
    ["blank caller_name", { ...input, caller_name: "  " }],
    ["missing to_user", { caller_name: "x", message: "y" }],
    ["message over 2000 chars", { ...input, message: "x".repeat(2001) }],
    ["unknown field", { ...input, requested_at: "2026-01-01T00:00:00Z" }],
  ])("rejects %s", (_n, value) => {
    expect(agentPhoneInput.safeParse(value).success).toBe(false);
  });
});

describe("agent-phone service", () => {
  it("declares the Bland key, TTL and one-call-per-recipient serialization", () => {
    const svc = createAgentPhoneService(deps());
    expect(svc.secrets).toEqual(["BLAND_API_KEY"]);
    expect(svc.ttlMs).toBe(8 * 60 * 1000);
    expect(svc.serializeBy?.(input)).toBe("alice");
  });

  it("places the call with the caller name in the prompt and returns the transcript", async () => {
    const d = deps();
    const result = await createAgentPhoneService(d).handle(input, ctx);
    expect(result).toEqual({
      ok: true,
      result: {
        outcome: "completed",
        transcript: "voice: hi\nuser: on it",
        call_length_seconds: 42,
      },
    });
    expect(d.userHasRegisteredHost).toHaveBeenCalledWith("u-alice", 3);
    const [phone, task, first] = vi.mocked(d.placeCallAndAwait).mock.calls[0];
    expect(phone).toBe("+15555550100");
    expect(task).toContain("Clipper the Box Maintainer");
    expect(first).toContain("CI failed");
  });

  it("treats no_response as delivered", async () => {
    const d = deps({
      placeCallAndAwait: vi.fn(async () => ({
        outcome: "no_response" as const,
      })),
    });
    const result = await createAgentPhoneService(d).handle(input, ctx);
    expect(result).toEqual({
      ok: true,
      result: { outcome: "no_response", transcript: "" },
    });
  });

  it("returns other call outcomes as the error code, keeping call length", async () => {
    const d = deps({
      placeCallAndAwait: vi.fn(async () => ({
        outcome: "no_answer" as const,
        message: "voicemail",
        call_length_seconds: 20,
      })),
    });
    expect(await createAgentPhoneService(d).handle(input, ctx)).toEqual({
      ok: false,
      code: "no_answer",
      message: "voicemail",
      details: { call_length_seconds: 20 },
    });
  });

  it.each([
    ["unknown_user", { getUserByUsername: vi.fn(async () => null) }],
    ["not_permitted", { userHasRegisteredHost: vi.fn(async () => false) }],
    [
      "no_phone_on_file",
      { getUserByUsername: vi.fn(async () => ({ id: "u", phoneE164: null })) },
    ],
    [
      "unknown",
      {
        getUserByUsername: vi.fn(async () =>
          Promise.reject(new Error("db locked")),
        ),
      },
    ],
    [
      "unknown",
      {
        userHasRegisteredHost: vi.fn(async () =>
          Promise.reject(new Error("db locked")),
        ),
      },
    ],
  ])("answers %s before dialing", async (code, overrides) => {
    const d = deps(overrides as Partial<AgentPhoneDeps>);
    const result = await createAgentPhoneService(d).handle(input, ctx);
    expect(result.ok === false && result.code).toBe(code);
    expect(d.placeCallAndAwait).not.toHaveBeenCalled();
  });
});
